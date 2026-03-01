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

async function loadAll() {
    try {
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
                forn: dbState.fornecedores[p.fornecedorId] || "---",
                codigo: p.codigo || "S/C"
            };
        });

        await syncUI();
    } catch (e) { console.error("Erro ao carregar dados:", e); }
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
}

// --- RENDERIZAÇÃO ---
function renderPendentes() {
    const area = document.getElementById("listaPendentes");
    if(!area) return;

    const pendentes = dbState.volumes.filter(v => v.quantidade > 0 && (!v.enderecoId || v.enderecoId === ""));
    document.getElementById("countPendentes").innerText = pendentes.length;

    area.innerHTML = pendentes.map(v => {
        const p = dbState.produtos[v.produtoId] || {nome: "Produto não encontrado", forn: "---"};
        return `
            <div class="vol-item-pendente" style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; margin-bottom:10px; border-left:4px solid var(--warning);">
                <div style="flex:1">
                    <small style="color:var(--warning)">${p.forn}</small><br>
                    <strong style="color:white;">${p.nome}</strong><br>
                    <small style="color:#aaa;">${v.descricao} | Qtd: ${v.quantidade}</small>
                </div>
                ${userRole !== 'leitor' ? `<button onclick="window.abrirModalMover('${v.id}')" class="btn-mover">MOVER</button>` : ''}
            </div>
        `;
    }).join('');
}

function renderEnderecos() {
    const grid = document.getElementById("gridEnderecos");
    if(!grid) return;
    grid.innerHTML = "";

    dbState.enderecos.forEach(end => {
        const vols = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        const card = document.createElement('div');
        card.className = "card-endereco";
        
        let htmlVols = vols.map(v => {
            const p = dbState.produtos[v.produtoId] || {nome:"---", forn:"---"};
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
                            <button onclick="window.darSaida('${v.id}', '${v.descricao}', ${v.quantidade})" style="color:var(--danger)"><i class="fas fa-sign-out-alt"></i></button>
                        </div>
                    ` : ''}
                </div>`;
        }).join('');

        card.innerHTML = `
            <div class="card-header">
                RUA ${end.rua} - MOD ${end.modulo}
                ${userRole === 'admin' ? `<i class="fas fa-trash" onclick="window.deletarLocal('${end.id}')" style="float:right; cursor:pointer;"></i>` : ''}
            </div>
            ${htmlVols || '<div style="text-align:center; padding:10px; color:#999;">Vazio</div>'}
        `;
        grid.appendChild(card);
    });
}

// --- EXPORTANDO PARA O WINDOW (RESOLVE O ERRO DE FUNÇÃO NÃO EXISTENTE) ---
window.abrirModalNovoEnd = () => {
    if(userRole !== 'admin') return;
    document.getElementById("modalTitle").innerText = "Novo Endereço";
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("modalBody").innerHTML = `
        <label>Rua:</label><input type="text" id="newRua" style="width:100%; margin-bottom:10px;">
        <label>Módulo:</label><input type="number" id="newMod" style="width:100%;">
    `;
    const btnSalvar = document.querySelector("#modalMaster .btn:not([onclick*='fechar'])");
    btnSalvar.onclick = window.salvarEndereco;
};

window.salvarEndereco = async () => {
    const rua = document.getElementById("newRua").value.toUpperCase();
    const mod = parseInt(document.getElementById("newMod").value);
    if(rua && mod) {
        await addDoc(collection(db, "enderecos"), { rua, modulo: mod });
        window.fecharModal();
        loadAll();
    }
};

window.deletarLocal = async (id) => {
    if(userRole !== 'admin') return;
    if(confirm("Deseja excluir este local?")) {
        await deleteDoc(doc(db, "enderecos", id));
        loadAll();
    }
};

window.abrirModalMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const p = dbState.produtos[vol.produtoId];
    document.getElementById("modalTitle").innerText = "Movimentar Volume";
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("modalBody").innerHTML = `
        <input type="hidden" id="modalVolId" value="${volId}">
        <p>Item: ${p.nome} (${vol.descricao})</p>
        <label>Quantidade:</label><input type="number" id="qtdMover" value="${vol.quantidade}" max="${vol.quantidade}" style="width:100%;">
        <label>Destino:</label>
        <select id="selDestino" style="width:100%;">
            <option value="">-- Selecione --</option>
            ${dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo}</option>`).join('')}
        </select>
    `;
    const btnSalvar = document.querySelector("#modalMaster .btn:not([onclick*='fechar'])");
    btnSalvar.onclick = window.confirmarMovimento;
};

window.confirmarMovimento = async () => {
    const volId = document.getElementById("modalVolId").value;
    const destId = document.getElementById("selDestino").value;
    const qtd = parseInt(document.getElementById("qtdMover").value);
    
    if(!destId || qtd <= 0) return alert("Dados inválidos");

    const vol = dbState.volumes.find(v => v.id === volId);
    // Lógica para somar se já houver o mesmo item no destino
    const existente = dbState.volumes.find(v => v.enderecoId === destId && v.produtoId === vol.produtoId && v.descricao === vol.descricao);

    if(existente) {
        await updateDoc(doc(db, "volumes", existente.id), { quantidade: increment(qtd) });
    } else {
        await addDoc(collection(db, "volumes"), { ...vol, id: null, quantidade: qtd, enderecoId: destId });
    }

    if(qtd === vol.quantidade) {
        await deleteDoc(doc(db, "volumes", volId));
    } else {
        await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtd) });
    }
    
    window.fecharModal();
    loadAll();
};

window.darSaida = async (id, desc, qtdAtual) => {
    const q = prompt(`Saída em: ${desc}\nQtd disponível: ${qtdAtual}\nDigite a quantidade:`);
    const qtd = parseInt(q);
    if(qtd > 0 && qtd <= qtdAtual) {
        if(qtd === qtdAtual) await deleteDoc(doc(db, "volumes", id));
        else await updateDoc(doc(db, "volumes", id), { quantidade: increment(-qtd) });
        loadAll();
    }
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
