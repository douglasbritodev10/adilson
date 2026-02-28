import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let usernameDB = "Usuário";
let userRole = "leitor";

// --- CONTROLE DE ACESSO ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const data = userSnap.data();
            usernameDB = data.nomeCompleto || "Usuário";
            userRole = (data.role || "leitor").toLowerCase();
            
            const btnEnd = document.getElementById("btnNovoEnd");
            if(btnEnd) btnEnd.style.display = (userRole === 'admin') ? 'block' : 'none';
        }
        const display = document.getElementById("userDisplay");
        if(display) display.innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB} (${userRole.toUpperCase()})`;
        loadAll();
    } else { 
        window.location.href = "index.html"; 
    }
});

// --- CARREGAMENTO DE DADOS ---
async function loadAll() {
    try {
        const fSnap = await getDocs(collection(db, "fornecedores"));
        dbState.fornecedores = {};
        const filtroForn = document.getElementById("filtroForn");
        if(filtroForn) filtroForn.innerHTML = '<option value="">Todos os Fornecedores</option>';

        fSnap.forEach(d => {
            dbState.fornecedores[d.id] = d.data().nome;
            if(filtroForn){
                let opt = document.createElement("option");
                opt.value = d.data().nome.toLowerCase();
                opt.innerText = d.data().nome;
                filtroForn.appendChild(opt);
            }
        });

        const pSnap = await getDocs(collection(db, "produtos"));
        dbState.produtos = {};
        pSnap.forEach(d => {
            const p = d.data();
            dbState.produtos[d.id] = { 
                nome: p.nome, 
                codigo: p.codigo || "S/C",
                forn: dbState.fornecedores[p.fornecedorId] || "---" 
            };
        });

        await syncUI();
    } catch (e) { console.error("Erro loadAll:", e); }
}

async function syncUI() {
    const eSnap = await getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo")));
    dbState.enderecos = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    const vSnap = await getDocs(collection(db, "volumes"));
    dbState.volumes = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    renderPendentes();
    renderEnderecos();
    if(window.filtrarEstoque) window.filtrarEstoque();
}

// --- MOVIMENTAÇÃO COM LÓGICA DE SOMA (25+25) ---
window.confirmarMovimentacao = async () => {
    const volId = document.getElementById("modalVolId")?.value;
    const destId = document.getElementById("selDestino")?.value;
    const qtdMover = parseInt(document.getElementById("qtdMover")?.value);

    if (!volId || !destId || isNaN(qtdMover) || qtdMover <= 0) {
        return alert("Preencha o destino e a quantidade corretamente!");
    }

    const volOrigem = dbState.volumes.find(v => v.id === volId);
    if (!volOrigem) return alert("Erro: Volume original não encontrado.");

    try {
        // Verifica se já existe o mesmo produto e volume no destino para SOMAR
        const itemExistente = dbState.volumes.find(v => 
            v.enderecoId === destId && 
            v.produtoId === volOrigem.produtoId && 
            v.descricao === volOrigem.descricao
        );

        if (itemExistente) {
            await updateDoc(doc(db, "volumes", itemExistente.id), {
                quantidade: increment(qtdMover),
                ultimaMov: serverTimestamp()
            });
        } else {
            await addDoc(collection(db, "volumes"), {
                produtoId: volOrigem.produtoId,
                descricao: volOrigem.descricao,
                quantidade: qtdMover,
                enderecoId: destId,
                dataMov: serverTimestamp()
            });
        }

        // Subtrai da origem
        const novaQtdOrigem = volOrigem.quantidade - qtdMover;
        await updateDoc(doc(db, "volumes", volId), {
            quantidade: novaQtdOrigem,
            enderecoId: novaQtdOrigem === 0 ? "" : volOrigem.enderecoId
        });

        window.fecharModal();
        loadAll();
    } catch (e) {
        console.error(e);
        alert("Erro técnico ao processar movimentação.");
    }
};

// --- CADASTRO DE ENDEREÇO COM TRAVA DE DUPLICIDADE ---
window.salvarNovoEndereco = async () => {
    const rua = document.getElementById("addRua")?.value.trim().toUpperCase();
    const mod = document.getElementById("addModulo")?.value.trim();
    const niv = document.getElementById("addNivel")?.value.trim() || "";

    if (!rua || !mod) return alert("Rua e Módulo são obrigatórios!");

    // Trava para não repetir endereço
    const duplicado = dbState.enderecos.find(e => e.rua === rua && e.modulo === mod && (e.nivel || "") === niv);
    if (duplicado) return alert("Este endereço já está cadastrado!");

    try {
        await addDoc(collection(db, "enderecos"), { rua, modulo: mod, nivel: niv });
        window.fecharModal();
        loadAll();
    } catch (e) { alert("Erro ao salvar endereço."); }
};

// --- MODAIS (GERANDO O BOTÃO ÚNICO) ---
window.abrirModalMover = (id) => {
    const v = dbState.volumes.find(vol => vol.id === id);
    if(!v) return;
    const p = dbState.produtos[v.produtoId] || {nome: "Produto"};

    document.getElementById("modalTitle").innerText = "Movimentar Estoque";
    document.getElementById("modalBody").innerHTML = `
        <input type="hidden" id="modalVolId" value="${v.id}">
        <div style="background:rgba(0,0,0,0.05); padding:10px; border-radius:8px; margin-bottom:15px;">
            <strong>${p.nome}</strong><br>
            <small>${v.descricao} | Saldo atual: ${v.quantidade}</small>
        </div>
        <label>Destino:</label>
        <select id="selDestino" class="form-control" style="width:100%; margin-bottom:10px; padding:8px;">
            <option value="">Selecione o Local...</option>
            ${dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo} ${e.nivel ? '- '+e.nivel : ''}</option>`).join('')}
        </select>
        <label>Quantidade a mover:</label>
        <input type="number" id="qtdMover" value="${v.quantidade}" max="${v.quantidade}" min="1" style="width:100%; padding:8px; margin-bottom:15px;">
        
        <button onclick="window.confirmarMovimentacao()" class="btn" style="width:100%; background:var(--success); color:white; font-weight:bold;">
            CONFIRMAR MOVIMENTAÇÃO
        </button>
    `;
    document.getElementById("modalMaster").style.display = "flex";
};

window.abrirModalNovoEnd = () => {
    document.getElementById("modalTitle").innerText = "Cadastrar Novo Endereço";
    document.getElementById("modalBody").innerHTML = `
        <input type="text" id="addRua" placeholder="Rua (Ex: A)" class="form-control" style="width:100%; margin-bottom:10px; padding:8px;">
        <input type="text" id="addModulo" placeholder="Módulo (Ex: 102)" class="form-control" style="width:100%; margin-bottom:10px; padding:8px;">
        <input type="text" id="addNivel" placeholder="Nível/Altura (Opcional)" class="form-control" style="width:100%; margin-bottom:15px; padding:8px;">
        <button onclick="window.salvarNovoEndereco()" class="btn" style="width:100%; background:var(--primary); color:white; font-weight:bold;">
            CADASTRAR ENDEREÇO
        </button>
    `;
    document.getElementById("modalMaster").style.display = "flex";
};

// --- RENDERIZAÇÃO E FILTROS (MANTIDOS ORIGINAIS) ---
function renderEnderecos() {
    const grid = document.getElementById("gridEnderecos");
    if(!grid) return;
    grid.innerHTML = "";

    dbState.enderecos.forEach(end => {
        const vols = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        const card = document.createElement('div');
        card.className = "card-endereco";
        
        let buscaTxt = `rua ${end.rua} mod ${end.modulo} ${end.nivel || ""} `;
        
        let htmlVols = vols.map(v => {
            const p = dbState.produtos[v.produtoId] || {nome:"---", forn:"---"};
            buscaTxt += `${p.nome} ${v.descricao} `.toLowerCase();
            return `
            <div class="vol-item">
                <div style="flex:1">
                    <small style="color:var(--primary)">${p.forn}</small><br>
                    <strong>${p.nome}</strong><br>
                    <small>${v.descricao} | Qtd: <b>${v.quantidade}</b></small>
                </div>
                ${userRole !== 'leitor' ? `
                <div class="actions">
                    <button onclick="window.abrirModalMover('${v.id}')"><i class="fas fa-exchange-alt"></i></button>
                    <button onclick="window.darSaida('${v.id}', '${v.descricao}')" style="color:var(--danger)"><i class="fas fa-sign-out-alt"></i></button>
                </div>` : ''}
            </div>`;
        }).join('');

        card.dataset.busca = buscaTxt;
        card.innerHTML = `
            <div class="card-header">
                <span>RUA ${end.rua} - MOD ${end.modulo}</span>
                ${userRole === 'admin' ? `<i class="fas fa-trash" onclick="window.deletarLocal('${end.id}')" style="cursor:pointer; opacity:0.5"></i>` : ""}
            </div>
            ${htmlVols || '<div style="padding:10px; color:#999; font-size:12px; text-align:center;">Vazio</div>'}
        `;
        grid.appendChild(card);
    });
}

function renderPendentes() {
    const area = document.getElementById("pendentesArea");
    if(!area) return;
    area.innerHTML = "";
    dbState.volumes.filter(v => v.quantidade > 0 && !v.enderecoId).forEach(v => {
        const p = dbState.produtos[v.produtoId] || {nome:"---"};
        const div = document.createElement("div");
        div.className = "vol-item-pendente";
        div.innerHTML = `
            <div style="flex:1">
                <strong>${p.nome}</strong><br>
                <small>${v.descricao} (Qtd: ${v.quantidade})</small>
            </div>
            ${userRole !== 'leitor' ? `<button onclick="window.abrirModalMover('${v.id}')" class="btn-pendente">MOVER</button>` : ''}
        `;
        area.appendChild(div);
    });
}

// Auxiliares
window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
window.darSaida = async (id, desc) => {
    const q = prompt(`Dar saída no volume: ${desc}\nQuantidade:`);
    if(q && parseInt(q) > 0) {
        await updateDoc(doc(db, "volumes", id), { quantidade: increment(-parseInt(q)) });
        loadAll();
    }
};
window.deletarLocal = async (id) => {
    if(confirm("Deseja excluir este endereço permanentemente?")) {
        await deleteDoc(doc(db, "enderecos", id));
        loadAll();
    }
};
window.filtrarEstoque = () => {
    const fCod = document.getElementById("filtroCod")?.value.toLowerCase() || "";
    const fForn = document.getElementById("filtroForn")?.value.toLowerCase() || "";
    const fDesc = document.getElementById("filtroDesc")?.value.toLowerCase() || "";
    let c = 0;
    document.querySelectorAll(".card-endereco").forEach(card => {
        const busca = card.dataset.busca || "";
        const match = busca.includes(fCod) && busca.includes(fDesc) && (fForn === "" || busca.includes(fForn));
        card.style.display = match ? "flex" : "none";
        if(match) c++;
    });
    const countDisp = document.getElementById("countDisplay");
    if(countDisp) countDisp.innerText = c;
};
window.limparFiltros = () => {
    document.getElementById("filtroCod").value = "";
    document.getElementById("filtroForn").value = "";
    document.getElementById("filtroDesc").value = "";
    window.filtrarEstoque();
};
