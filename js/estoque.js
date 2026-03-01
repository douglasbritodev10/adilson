import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let userRole = "leitor";
let usernameDB = "Usuário";

// --- AUTH E ACESSO ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
            const data = userSnap.data();
            usernameDB = data.nomeCompleto || user.email.split('@')[0].toUpperCase();
            userRole = (data.role || "leitor").toLowerCase();
            if(userRole === 'admin') document.getElementById("btnNovoEnd").style.display = 'block';
        }
        document.getElementById("userDisplay").innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB}`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

document.getElementById("btnLogout").onclick = () => signOut(auth);

// --- CARREGAR DADOS ---
async function loadAll() {
    const [fSnap, pSnap, eSnap, vSnap] = await Promise.all([
        getDocs(collection(db, "fornecedores")),
        getDocs(collection(db, "produtos")),
        getDocs(query(collection(db, "enderecos"), orderBy("nome"))),
        getDocs(collection(db, "volumes"))
    ]);

    dbState.fornecedores = {};
    fSnap.forEach(d => dbState.fornecedores[d.id] = d.data().nome);
    
    dbState.produtos = {};
    pSnap.forEach(d => dbState.produtos[d.id] = d.data());

    dbState.enderecos = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    dbState.volumes = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const selF = document.getElementById("filtroForn");
    selF.innerHTML = '<option value="">Todos Fornecedores</option>';
    Object.entries(dbState.fornecedores).forEach(([id, nome]) => {
        selF.innerHTML += `<option value="${id}">${nome}</option>`;
    });

    renderizar();
}

// --- RENDERIZAR INTERFACE ---
window.filtrarEstoque = () => renderizar();

function renderizar() {
    const fCod = document.getElementById("filtroCod").value.toUpperCase();
    const fForn = document.getElementById("filtroForn").value;
    const fDesc = document.getElementById("filtroDesc").value.toUpperCase();
    const grid = document.getElementById("gridEnderecos");
    grid.innerHTML = "";

    dbState.enderecos.forEach(end => {
        const vols = dbState.volumes.filter(v => v.enderecoId === end.id);
        const filtrados = vols.filter(v => {
            const p = dbState.produtos[v.produtoId] || {};
            return (!fCod || v.codigo?.includes(fCod)) &&
                   (!fForn || p.fornecedorId === fForn) &&
                   (!fDesc || v.descricao?.includes(fDesc));
        });

        if (filtrados.length > 0 || (!fCod && !fForn && !fDesc)) {
            let htmlVols = filtrados.map(v => `
                <div class="vol-item">
                    <div class="vol-info">
                        <strong>${v.codigo}</strong> - Qtd: ${v.quantidade}<br>
                        <small>${v.descricao}</small>
                    </div>
                    <div class="vol-actions">
                        <button class="btn-action" style="background:var(--warning)" onclick="window.abrirMover('${v.id}')"><i class="fas fa-exchange-alt"></i></button>
                        <button class="btn-action" style="background:var(--danger)" onclick="window.darSaida('${v.id}')"><i class="fas fa-sign-out-alt"></i></button>
                    </div>
                </div>
            `).join('');

            grid.innerHTML += `
                <div class="endereco-card">
                    <div class="end-header">
                        <span>${end.nome}</span>
                        ${userRole === 'admin' ? `<i class="fas fa-trash" style="cursor:pointer;color:red;font-size:0.8rem" onclick="window.excluirEnd('${end.id}')"></i>` : ''}
                    </div>
                    ${htmlVols || '<small style="color:gray">Endereço vazio</small>'}
                </div>`;
        }
    });
}

// --- LOGICA DE MOVIMENTAÇÃO ---

window.abrirMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    if(!vol) return;

    document.getElementById("modalTitle").innerText = "Mover Volume";
    document.getElementById("modalBody").innerHTML = `
        <label>DESTINO:</label>
        <select id="moveDest">
            ${dbState.enderecos.map(e => `<option value="${e.id}">${e.nome}</option>`).join('')}
        </select>
        <label>QUANTIDADE (Máx: ${vol.quantidade}):</label>
        <input type="number" id="moveQtd" value="${vol.quantidade}" min="1" max="${vol.quantidade}">
    `;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnModalConfirm").onclick = () => realizarMovimentacao(volId);
};

async function realizarMovimentacao(volId) {
    const vol = dbState.volumes.find(v => v.id === volId);
    const destId = document.getElementById("moveDest").value;
    const qtd = parseInt(document.getElementById("moveQtd").value);

    if(!destId || isNaN(qtd) || qtd <= 0 || qtd > vol.quantidade) return alert("Verifique os dados!");

    try {
        const destNome = dbState.enderecos.find(e => e.id === destId).nome;
        
        // 1. Diminuir ou excluir da origem
        if(qtd === vol.quantidade) await deleteDoc(doc(db, "volumes", volId));
        else await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtd) });

        // 2. Adicionar no destino (ou somar se já existir o mesmo produto/descrição lá)
        const la = dbState.volumes.find(v => v.enderecoId === destId && v.produtoId === vol.produtoId && v.descricao === vol.descricao);
        if(la) {
            await updateDoc(doc(db, "volumes", la.id), { quantidade: increment(qtd) });
        } else {
            await addDoc(collection(db, "volumes"), { ...vol, id: null, quantidade: qtd, enderecoId: destId });
        }

        // 3. Registrar Histórico
        await addDoc(collection(db, "movimentacoes"), {
            tipo: "Transferência",
            produto: vol.descricao,
            quantidade: qtd,
            observacao: `Movido para ${destNome}`,
            usuario: usernameDB,
            data: serverTimestamp()
        });

        window.fecharModal();
        loadAll();
    } catch (e) { console.error(e); }
}

window.darSaida = async (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const qtd = prompt(`Dar SAÍDA em: ${vol.descricao}\nQtd disponível: ${vol.quantidade}\nDigite a quantidade:`, vol.quantidade);
    const qtdNum = parseInt(qtd);

    if(qtdNum > 0 && qtdNum <= vol.quantidade) {
        if(qtdNum === vol.quantidade) await deleteDoc(doc(db, "volumes", volId));
        else await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtdNum) });

        await addDoc(collection(db, "movimentacoes"), {
            tipo: "Saída",
            produto: vol.descricao,
            quantidade: qtdNum,
            observacao: "Saída direta via Mapa",
            usuario: usernameDB,
            data: serverTimestamp()
        });
        loadAll();
    }
};

window.modalNovoEnd = () => {
    document.getElementById("modalTitle").innerText = "Novo Endereço";
    document.getElementById("modalBody").innerHTML = `<label>NOME DA RUA/BOX:</label><input type="text" id="newEndNome" placeholder="Ex: RUA A - 01">`;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnModalConfirm").onclick = async () => {
        const nome = document.getElementById("newEndNome").value.toUpperCase();
        if(!nome) return;
        await addDoc(collection(db, "enderecos"), { nome });
        window.fecharModal();
        loadAll();
    };
};

window.excluirEnd = async (id) => {
    if(dbState.volumes.some(v => v.enderecoId === id)) return alert("Remova os produtos do endereço antes de excluir!");
    if(confirm("Excluir este endereço?")) {
        await deleteDoc(doc(db, "enderecos", id));
        loadAll();
    }
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
