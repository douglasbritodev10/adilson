import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let userRole = "leitor";
let usernameDB = "Usuário";

// --- AUTH E CONTROLE DE ACESSO ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
            const data = userSnap.data();
            usernameDB = data.nomeCompleto || user.email.split('@')[0].toUpperCase();
            userRole = (data.role || "leitor").toLowerCase();
            if(userRole === 'admin') document.getElementById("btnNovoEnd").style.display = 'block';
        }
        document.getElementById("userDisplay").innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB} (${userRole.toUpperCase()})`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

window.logout = () => signOut(auth).then(() => window.location.href = "index.html");

// --- CARREGAMENTO DE DADOS ---
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

    popularFiltroFornecedores();
    renderizarEstoque();
}

function popularFiltroFornecedores() {
    const sel = document.getElementById("filtroForn");
    const valAtual = sel.value;
    sel.innerHTML = '<option value="">Todos Fornecedores</option>';
    Object.entries(dbState.fornecedores).forEach(([id, nome]) => {
        sel.innerHTML += `<option value="${id}">${nome}</option>`;
    });
    sel.value = valAtual;
}

// --- RENDERIZAÇÃO E FILTROS ---
window.filtrarEstoque = () => renderizarEstoque();

function renderizarEstoque() {
    const fCod = document.getElementById("filtroCod").value.toUpperCase();
    const fForn = document.getElementById("filtroForn").value;
    const fDesc = document.getElementById("filtroDesc").value.toUpperCase();
    const grid = document.getElementById("gridEnderecos");
    grid.innerHTML = "";

    dbState.enderecos.forEach(end => {
        const volsDoEndereco = dbState.volumes.filter(v => v.enderecoId === end.id);
        
        // Filtra volumes
        const volsFiltrados = volsDoEndereco.filter(v => {
            const prod = dbState.produtos[v.produtoId] || {};
            const matchCod = !fCod || (v.codigo?.toUpperCase().includes(fCod) || prod.codigo?.toUpperCase().includes(fCod));
            const matchForn = !fForn || prod.fornecedorId === fForn;
            const matchDesc = !fDesc || (v.descricao?.toUpperCase().includes(fDesc) || prod.nome?.toUpperCase().includes(fDesc));
            return matchCod && matchForn && matchDesc;
        });

        if (volsFiltrados.length > 0 || (!fCod && !fForn && !fDesc)) {
            let htmlVols = volsFiltrados.map(v => {
                const p = dbState.produtos[v.produtoId] || { nome: "N/D" };
                return `
                <div class="vol-item">
                    <div class="vol-info">
                        <strong>${v.codigo}</strong> - ${p.nome}<br>
                        <small>${v.descricao} | Qtd: ${v.quantidade}</small>
                    </div>
                    <div class="vol-actions">
                        <button class="btn-sm" style="background:var(--warning)" onclick="window.abrirModalMover('${v.id}')"><i class="fas fa-exchange-alt"></i></button>
                        <button class="btn-sm" style="background:var(--danger)" onclick="window.darSaida('${v.id}', '${v.descricao}', ${v.quantidade})"><i class="fas fa-minus"></i></button>
                    </div>
                </div>`;
            }).join('');

            grid.innerHTML += `
                <div class="endereco-card">
                    <div class="end-header">
                        <span class="end-title">${end.nome}</span>
                        ${userRole === 'admin' ? `<button onclick="window.excluirEnd('${end.id}', '${end.nome}')" style="border:none; background:none; color:red; cursor:pointer;"><i class="fas fa-trash"></i></button>` : ''}
                    </div>
                    ${htmlVols || '<small style="color:#999">Vazio</small>'}
                </div>`;
        }
    });
}

// --- MOVIMENTAÇÕES E HISTÓRICO ---

window.abrirModalMover = async (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    if(!vol) return;

    document.getElementById("modalTitle").innerText = "Mover Volume";
    document.getElementById("modalBody").innerHTML = `
        <label>Destino:</label>
        <select id="selDestino">
            <option value="">Selecione o endereço...</option>
            ${dbState.enderecos.map(e => `<option value="${e.id}">${e.nome}</option>`).join('')}
        </select>
        <label>Quantidade:</label>
        <input type="number" id="qtdMover" value="${vol.quantidade}" max="${vol.quantidade}" min="1">
    `;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnModalConfirm").onclick = () => confirmarMovimento(volId);
};

async function confirmarMovimento(volId) {
    const destId = document.getElementById("selDestino").value;
    const qtd = parseInt(document.getElementById("qtdMover").value);
    const vol = dbState.volumes.find(v => v.id === volId);

    if(!destId || isNaN(qtd) || qtd <= 0 || qtd > vol.quantidade) return alert("Verifique os dados!");

    try {
        const destNome = dbState.enderecos.find(e => e.id === destId).nome;
        const prod = dbState.produtos[vol.produtoId] || { nome: "Desconhecido" };

        // 1. Adicionar ao destino
        const existente = dbState.volumes.find(v => v.enderecoId === destId && v.produtoId === vol.produtoId && v.descricao === vol.descricao);
        if(existente) {
            await updateDoc(doc(db, "volumes", existente.id), { quantidade: increment(qtd) });
        } else {
            await addDoc(collection(db, "volumes"), { ...vol, id: null, quantidade: qtd, enderecoId: destId });
        }

        // 2. Subtrair da origem
        if(qtd === vol.quantidade) {
            await deleteDoc(doc(db, "volumes", volId));
        } else {
            await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtd) });
        }

        // 3. Registrar Histórico
        await registrarAcao("Saída/Mov", prod.nome, qtd, `Movido para ${destNome}`);
        
        window.fecharModal();
        loadAll();
    } catch (e) { console.error(e); }
}

window.darSaida = async (volId, desc, qtdAtual) => {
    const q = prompt(`Dar SAÍDA em: ${desc}\nQtd disponível: ${qtdAtual}\nDigite a quantidade:`);
    const qtd = parseInt(q);
    if(isNaN(qtd) || qtd <= 0 || qtd > qtdAtual) return;

    if(confirm(`Confirmar saída de ${qtd} unidades?`)) {
        const vol = dbState.volumes.find(v => v.id === volId);
        const prod = dbState.produtos[vol.produtoId] || { nome: "Desconhecido" };

        if(qtd === qtdAtual) await deleteDoc(doc(db, "volumes", volId));
        else await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtd) });

        await registrarAcao("Saída", prod.nome, qtd, `Saída direta do estoque`);
        loadAll();
    }
};

async function registrarAcao(tipo, produto, qtd, obs = "") {
    await addDoc(collection(db, "movimentacoes"), {
        tipo, produto, quantidade: qtd, observacao: obs,
        usuario: usernameDB, data: serverTimestamp()
    });
}

// --- GESTÃO DE ENDEREÇOS ---
window.modalNovoEnd = () => {
    document.getElementById("modalTitle").innerText = "Novo Endereço";
    document.getElementById("modalBody").innerHTML = `<input type="text" id="nomeEnd" placeholder="Ex: RUA A - 01">`;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnModalConfirm").onclick = async () => {
        const nome = document.getElementById("nomeEnd").value.toUpperCase();
        if(!nome) return;
        await addDoc(collection(db, "enderecos"), { nome });
        window.fecharModal();
        loadAll();
    };
};

window.excluirEnd = async (id, nome) => {
    const temItem = dbState.volumes.some(v => v.enderecoId === id);
    if(temItem) return alert("Não é possível excluir um endereço com produtos!");
    if(confirm(`Excluir endereço ${nome}?`)) {
        await deleteDoc(doc(db, "enderecos", id));
        loadAll();
    }
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
