import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let userRole = "leitor";

// --- CONTROLE DE ACESSO PROFISSIONAL ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
            userRole = (userSnap.data().role || "leitor").toLowerCase();
            
            // UI de acordo com o cargo
            const btnEnd = document.getElementById("btnNovoEnd");
            if(btnEnd) btnEnd.style.display = (userRole === 'admin') ? 'block' : 'none';
        }
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    try {
        // Carrega Fornecedores e Produtos para o Cache
        const [fS, pS] = await Promise.all([
            getDocs(collection(db, "fornecedores")),
            getDocs(collection(db, "produtos"))
        ]);

        dbState.fornecedores = {};
        fS.forEach(d => dbState.fornecedores[d.id] = d.data().nome);

        dbState.produtos = {};
        pS.forEach(d => {
            const p = d.data();
            dbState.produtos[d.id] = { 
                nome: p.nome, 
                forn: dbState.fornecedores[p.fornecedorId] || "---" 
            };
        });

        await syncUI();
    } catch (e) { console.error(e); }
}

async function syncUI() {
    const [eS, vS] = await Promise.all([
        getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo"))),
        getDocs(collection(db, "volumes"))
    ]);

    dbState.enderecos = eS.docs.map(d => ({ id: d.id, ...d.data() }));
    dbState.volumes = vS.docs.map(d => ({ id: d.id, ...d.data() }));

    renderPendentes();
    renderEnderecos();
    window.filtrarEstoque();
}

// --- LOGICA DE ENDEREÇAMENTO E JUNÇÃO ---
function renderPendentes() {
    const area = document.getElementById("pendentesArea");
    const count = document.getElementById("countPendentes");
    if(!area) return;

    // Filtra volumes com quantidade > 0 que não possuem endereço
    const pendentes = dbState.volumes.filter(v => v.quantidade > 0 && (!v.enderecoId || v.enderecoId === ""));
    
    count.innerText = pendentes.length;
    area.innerHTML = pendentes.map(v => {
        const p = dbState.produtos[v.produtoId] || {nome:"Prod. Excluído"};
        return `
            <div class="vol-item-pendente">
                <div style="flex:1">
                    <strong>${p.nome}</strong><br>
                    <small>${v.descricao} | Qtd: ${v.quantidade}</small>
                </div>
                ${userRole !== 'leitor' ? 
                    `<button onclick="window.abrirModalMover('${v.id}')" class="btn-pendente">ENDEREÇAR</button>` : ''}
            </div>
        `;
    }).join('');
}

window.confirmarMovimentacao = async () => {
    const volId = document.getElementById("modalVolId")?.value;
    const destId = document.getElementById("selDestino")?.value;
    const qtdMover = parseInt(document.getElementById("qtdMover")?.value);

    if (!volId || !destId || isNaN(qtdMover)) return alert("Preencha tudo!");

    const volOrigem = dbState.volumes.find(v => v.id === volId);
    
    try {
        // Busca se já existe este produto/descrição no endereço de destino
        const destinoExistente = dbState.volumes.find(v => 
            v.enderecoId === destId && 
            v.produtoId === volOrigem.produtoId && 
            v.descricao.trim().toLowerCase() === volOrigem.descricao.trim().toLowerCase()
        );

        // 1. Aumenta no Destino (ou cria novo)
        if (destinoExistente) {
            await updateDoc(doc(db, "volumes", destinoExistente.id), {
                quantidade: increment(qtdMover),
                ultimaMov: serverTimestamp()
            });
        } else {
            await addDoc(collection(db, "volumes"), {
                ...volOrigem,
                id: null, // Deixa o Firestore gerar novo ID
                quantidade: qtdMover,
                enderecoId: destId,
                dataMov: serverTimestamp()
            });
        }

        // 2. Diminui na Origem
        const novaQtd = volOrigem.quantidade - qtdMover;
        await updateDoc(doc(db, "volumes", volId), {
            quantidade: novaQtd,
            // Se zerou e estava em um endereço, o registro fica vazio. 
            // Se era pendente, ele some da lista.
            enderecoId: novaQtd <= 0 ? "EXCLUIDO" : volOrigem.enderecoId 
        });

        window.fecharModal();
        loadAll();
    } catch (e) { console.error(e); }
};

// --- RENDERIZAÇÃO DO GRID ---
function renderEnderecos() {
    const grid = document.getElementById("gridEnderecos");
    if(!grid) return;
    grid.innerHTML = "";

    dbState.enderecos.forEach(end => {
        const vols = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        const card = document.createElement('div');
        card.className = "card-endereco";
        
        let buscaTxt = `rua ${end.rua} mod ${end.modulo} `.toLowerCase();
        
        let htmlVols = vols.map(v => {
            const p = dbState.produtos[v.produtoId] || {nome:"---", forn:"---"};
            buscaTxt += `${p.nome} ${p.forn} ${v.descricao} `.toLowerCase();
            return `
                <div class="vol-item">
                    <div style="flex:1">
                        <small><b>${p.forn}</b></small><br>
                        <strong>${p.nome}</strong><br>
                        <small>${v.descricao} | Qtd: ${v.quantidade}</small>
                    </div>
                    ${userRole !== 'leitor' ? `
                        <div class="actions">
                            <button onclick="window.abrirModalMover('${v.id}')"><i class="fas fa-exchange-alt"></i></button>
                            <button onclick="window.darSaida('${v.id}', '${v.descricao}')" style="color:var(--danger)"><i class="fas fa-sign-out-alt"></i></button>
                        </div>
                    ` : ''}
                </div>`;
        }).join('');

        card.dataset.busca = buscaTxt;
        card.innerHTML = `
            <div class="card-header">RUA ${end.rua} - MOD ${end.modulo}</div>
            ${htmlVols || '<div style="text-align:center; padding:10px; color:#999;">Vazio</div>'}
        `;
        grid.appendChild(card);
    });
}
// --- FILTROS ---
window.filtrarEstoque = () => {
    const fCod = document.getElementById("filtroCod")?.value.toLowerCase() || "";
    const fForn = document.getElementById("filtroForn")?.value.toLowerCase() || "";
    const fDesc = document.getElementById("filtroDesc")?.value.toLowerCase() || "";
    let c = 0;

    document.querySelectorAll(".card-endereco").forEach(card => {
        const busca = card.dataset.busca || "";
        // Verifica se o texto de busca do card contém o código AND descrição AND fornecedor
        const match = busca.includes(fCod) && busca.includes(fDesc) && (fForn === "" || busca.includes(fForn));
        
        card.style.display = match ? "flex" : "none";
        if(match) c++;
    });

    const countDisp = document.getElementById("countDisplay");
    if(countDisp) countDisp.innerText = c;
};

// --- RESTANTE DAS FUNÇÕES (MODAIS E AUXILIARES) ---
window.abrirModalMover = (id) => {
    const v = dbState.volumes.find(vol => vol.id === id);
    if(!v) return;
    const p = dbState.produtos[v.produtoId] || {nome: "Produto"};

    document.getElementById("modalTitle").innerText = "Movimentar Estoque";
    document.getElementById("modalBody").innerHTML = `
        <input type="hidden" id="modalVolId" value="${v.id}">
        <div style="background:rgba(0,0,0,0.05); padding:10px; border-radius:8px; margin-bottom:15px;">
            <small>${p.forn}</small><br>
            <strong>${p.nome}</strong><br>
            <small>${v.descricao} | Saldo: ${v.quantidade}</small>
        </div>
        <label>Para onde deseja mover?</label>
        <select id="selDestino" class="form-control" style="width:100%; margin-bottom:10px; padding:10px;">
            <option value="">Selecione o Endereço...</option>
            ${dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo} ${e.nivel ? '('+e.nivel+')' : ''}</option>`).join('')}
        </select>
        <label>Quantidade:</label>
        <input type="number" id="qtdMover" value="${v.quantidade}" max="${v.quantidade}" min="1" class="form-control" style="width:100%; padding:10px; margin-bottom:15px;">
        
        <button onclick="window.confirmarMovimentacao()" class="btn" style="width:100%; background:var(--success); color:white; font-weight:bold; height:45px;">
            CONFIRMAR MOVIMENTAÇÃO
        </button>
    `;
    document.getElementById("modalMaster").style.display = "flex";
};

window.abrirModalNovoEnd = () => {
    document.getElementById("modalTitle").innerText = "Novo Endereço";
    document.getElementById("modalBody").innerHTML = `
        <input type="text" id="addRua" placeholder="Rua (Ex: A)" class="form-control" style="width:100%; margin-bottom:10px; padding:10px;">
        <input type="text" id="addModulo" placeholder="Módulo (Ex: 102)" class="form-control" style="width:100%; margin-bottom:10px; padding:10px;">
        <input type="text" id="addNivel" placeholder="Nível/Altura (Opcional)" class="form-control" style="width:100%; margin-bottom:15px; padding:10px;">
        <button onclick="window.salvarNovoEndereco()" class="btn" style="width:100%; background:var(--primary); color:white; font-weight:bold; height:45px;">
            CADASTRAR ENDEREÇO
        </button>
    `;
    document.getElementById("modalMaster").style.display = "flex";
};

window.salvarNovoEndereco = async () => {
    const rua = document.getElementById("addRua")?.value.trim().toUpperCase();
    const mod = document.getElementById("addModulo")?.value.trim();
    const niv = document.getElementById("addNivel")?.value.trim() || "";
    if (!rua || !mod) return alert("Rua e Módulo são obrigatórios!");
    const duplicado = dbState.enderecos.find(e => e.rua === rua && e.modulo === mod && (e.nivel || "") === niv);
    if (duplicado) return alert("Este endereço já existe!");
    try {
        await addDoc(collection(db, "enderecos"), { rua, modulo: mod, nivel: niv });
        window.fecharModal();
        loadAll();
    } catch (e) { alert("Erro ao salvar."); }
};

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

window.limparFiltros = () => {
    document.getElementById("filtroCod").value = "";
    document.getElementById("filtroForn").value = "";
    document.getElementById("filtroDesc").value = "";
    window.filtrarEstoque();
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");

window.darSaida = async (id, desc) => {
    const q = prompt(`Saída: ${desc}\nQuantidade:`);
    if(q && parseInt(q) > 0) {
        await updateDoc(doc(db, "volumes", id), { quantidade: increment(-parseInt(q)) });
        loadAll();
    }
};

window.deletarLocal = async (id) => {
    if(confirm("Excluir endereço permanentemente?")) {
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
