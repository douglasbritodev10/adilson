import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let usernameDB = "Usuário";
let userRole = "leitor";

// --- CONTROLE DE ACESSO E PERMISSÕES ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const data = userSnap.data();
            usernameDB = data.nomeCompleto || "Usuário";
            userRole = data.role || "leitor";
            
            // Exibe botão de novo endereço apenas para Admins
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
    } catch (e) { console.error("Erro ao carregar dados:", e); }
}

async function syncUI() {
    const eSnap = await getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo")));
    dbState.enderecos = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    const vSnap = await getDocs(collection(db, "volumes"));
    dbState.volumes = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    renderPendentes();
    renderEnderecos();
    window.filtrarEstoque();
}

// --- LOGICA DE ENDEREÇAMENTO (SOMA 25+25) ---
window.confirmarMovimentacao = async () => {
    if (userRole === "leitor") return alert("Acesso negado.");

    const volId = document.getElementById("modalVolId").value;
    const destId = document.getElementById("selDestino").value;
    const qtdMover = parseInt(document.getElementById("qtdMover").value);

    if (!destId) return alert("Selecione um destino!");

    const volOrigem = dbState.volumes.find(v => v.id === volId);
    if (!volOrigem || isNaN(qtdMover) || qtdMover <= 0 || qtdMover > volOrigem.quantidade) {
        return alert("Quantidade inválida!");
    }

    try {
        // BUSCA SOMA: Verifica se já existe o mesmo produto + volume no destino
        const itemExistente = dbState.volumes.find(v => 
            v.enderecoId === destId && 
            v.produtoId === volOrigem.produtoId && 
            v.descricao === volOrigem.descricao
        );

        if (itemExistente) {
            // Se existe, soma a quantidade no registro que já está lá
            await updateDoc(doc(db, "volumes", itemExistente.id), {
                quantidade: increment(qtdMover),
                ultimaMov: serverTimestamp()
            });
        } else {
            // Se não existe, cria um novo registro naquele endereço
            await addDoc(collection(db, "volumes"), {
                produtoId: volOrigem.produtoId,
                descricao: volOrigem.descricao,
                codigoVol: volOrigem.codigoVol || "",
                quantidade: qtdMover,
                enderecoId: destId,
                dataMov: serverTimestamp()
            });
        }

        // Subtrai da origem
        const novaQtdOrigem = volOrigem.quantidade - qtdMover;
        if (novaQtdOrigem === 0) {
            // Se esvaziou, remove o vínculo de endereço ou apaga se for temporário
            await updateDoc(doc(db, "volumes", volId), { 
                quantidade: 0, 
                enderecoId: "" 
            });
        } else {
            await updateDoc(doc(db, "volumes", volId), {
                quantidade: increment(-qtdMover)
            });
        }

        window.fecharModal();
        loadAll();
    } catch (e) {
        console.error(e);
        alert("Erro ao processar movimentação.");
    }
};

// --- CADASTRO DE NOVO ENDEREÇO COM TRAVA DE DUPLICADO ---
window.salvarNovoEndereco = async () => {
    if (userRole !== "admin") return;

    const rua = document.getElementById("addRua").value.trim().toUpperCase();
    const mod = document.getElementById("addModulo").value.trim();
    const niv = document.getElementById("addNivel").value.trim();

    if (!rua || !mod) return alert("Rua e Módulo são obrigatórios!");

    // TRAVA: Verifica se esse endereço exato já existe no dbState
    const jaExiste = dbState.enderecos.find(e => 
        e.rua === rua && e.modulo === mod && e.nivel === niv
    );

    if (jaExiste) {
        return alert(`Erro: O endereço RUA ${rua} - MOD ${mod} já existe no sistema!`);
    }

    try {
        await addDoc(collection(db, "enderecos"), {
            rua, modulo: mod, nivel: niv,
            criadoEm: serverTimestamp()
        });
        window.fecharModal();
        loadAll();
    } catch (e) { alert("Erro ao cadastrar endereço."); }
};

// --- RENDERIZAÇÃO ---
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
            const p = dbState.produtos[v.produtoId] || {nome:"Prod. Removido", codigo:"?", forn:"?"};
            buscaTxt += `${p.nome} ${p.codigo} ${v.descricao} ${p.forn} `.toLowerCase();
            
            return `
            <div class="vol-item">
                <div style="flex:1">
                    <div style="font-size:10px; color:var(--primary); font-weight:bold; text-transform:uppercase;">${p.forn}</div>
                    <div style="font-weight:bold; font-size:13px;">${p.nome}</div>
                    <div style="font-size:11px; color:#555;">
                        Cód: ${p.codigo} | Vol: ${v.descricao} | <b>Qtd: ${v.quantidade}</b>
                    </div>
                </div>
                ${userRole !== 'leitor' ? `
                <div class="actions">
                    <button onclick="window.abrirModalMover('${v.id}')" title="Mover"><i class="fas fa-exchange-alt"></i></button>
                    <button onclick="window.darSaida('${v.id}', '${v.descricao}')" title="Saída" style="color:var(--danger)"><i class="fas fa-sign-out-alt"></i></button>
                </div>` : ''}
            </div>`;
        }).join('');

        card.dataset.busca = buscaTxt;
        card.innerHTML = `
            <div class="card-header">
                <span>RUA ${end.rua} - MOD ${end.modulo} ${end.nivel ? `- NIV ${end.nivel}` : ""}</span>
                ${userRole === 'admin' ? `<i class="fas fa-trash" onclick="window.deletarLocal('${end.id}')" style="cursor:pointer; opacity:0.5; font-size:12px;"></i>` : ""}
            </div>
            ${htmlVols || '<div style="padding:15px; color:#999; font-size:12px; text-align:center;">Vazio</div>'}
        `;
        grid.appendChild(card);
    });
}

function renderPendentes() {
    const area = document.getElementById("pendentesArea");
    if(!area) return;
    area.innerHTML = "";

    const pendentes = dbState.volumes.filter(v => v.quantidade > 0 && (!v.enderecoId || v.enderecoId === ""));
    
    pendentes.forEach(v => {
        const p = dbState.produtos[v.produtoId] || {nome:"---"};
        const item = document.createElement("div");
        item.className = "vol-item-pendente";
        item.innerHTML = `
            <div style="font-weight:bold; font-size:12px;">${p.nome}</div>
            <div style="font-size:11px;">${v.descricao} - <b>Qtd: ${v.quantidade}</b></div>
            ${userRole !== 'leitor' ? `<button onclick="window.abrirModalMover('${v.id}')" class="btn-pendente">ENDEREÇAR</button>` : ''}
        `;
        area.appendChild(item);
    });
}

// --- MODAIS E FILTROS ---
window.abrirModalMover = (id) => {
    const v = dbState.volumes.find(vol => vol.id === id);
    const p = dbState.produtos[v.produtoId];
    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = "Endereçar Volume";
    document.getElementById("modalBody").innerHTML = `
        <input type="hidden" id="modalVolId" value="${v.id}">
        <div style="background:#f8f9fa; padding:10px; border-radius:5px; margin-bottom:15px; font-size:13px;">
            <strong>${p.nome}</strong><br>Volume: ${v.descricao} | Saldo: ${v.quantidade}
        </div>
        <label>Destino:</label>
        <select id="selDestino" style="width:100%; padding:10px; margin-bottom:10px;">
            <option value="">Selecione um local...</option>
            ${dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo} ${e.nivel ? `(Nív ${e.nivel})` : ""}</option>`).join('')}
        </select>
        <label>Quantidade a Mover:</label>
        <input type="number" id="qtdMover" value="${v.quantidade}" max="${v.quantidade}" min="1" style="width:100%; padding:10px;">
        <button onclick="window.confirmarMovimentacao()" class="btn" style="width:100%; margin-top:15px; background:var(--success); color:white;">CONFIRMAR</button>
    `;
    modal.style.display = "flex";
};

window.abrirModalNovoEnd = () => {
    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = "Cadastrar Novo Endereço";
    document.getElementById("modalBody").innerHTML = `
        <input type="text" id="addRua" placeholder="Rua (Ex: A)" style="width:100%; padding:10px; margin-bottom:10px;">
        <input type="text" id="addModulo" placeholder="Módulo (Ex: 001)" style="width:100%; padding:10px; margin-bottom:10px;">
        <input type="text" id="addNivel" placeholder="Nível (Opcional)" style="width:100%; padding:10px; margin-bottom:10px;">
        <button onclick="window.salvarNovoEndereco()" class="btn" style="width:100%; background:var(--primary); color:white;">SALVAR LOCAL</button>
    `;
    modal.style.display = "flex";
};

window.darSaida = async (id, desc) => {
    const qtd = prompt(`Saída de Volume: ${desc}\nDigite a quantidade:`);
    if(qtd && parseInt(qtd) > 0){
        try {
            await updateDoc(doc(db, "volumes", id), { quantidade: increment(-parseInt(qtd)) });
            loadAll();
        } catch(e){ alert("Erro na saída."); }
    }
};

window.deletarLocal = async (id) => {
    if(confirm("Deseja excluir este endereço? Volumes vinculados ficarão sem endereço.")){
        try {
            const afetados = dbState.volumes.filter(v => v.enderecoId === id);
            for(let v of afetados) { 
                await updateDoc(doc(db, "volumes", v.id), { enderecoId: "" }); 
            }
            await deleteDoc(doc(db, "enderecos", id));
            loadAll();
        } catch(e) { console.error(e); alert("Erro ao excluir."); }
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
    if(document.getElementById("filtroCod")) document.getElementById("filtroCod").value = "";
    if(document.getElementById("filtroForn")) document.getElementById("filtroForn").value = "";
    if(document.getElementById("filtroDesc")) document.getElementById("filtroDesc").value = "";
    window.filtrarEstoque();
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
