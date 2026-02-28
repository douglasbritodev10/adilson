import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let currentUserData = null;

onAuthStateChanged(auth, async user => {
    if (user) {
        // BUSCA O USERNAME NO FIRESTORE (users/uid)
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            currentUserData = userSnap.data();
            document.getElementById("spanUser").innerText = currentUserData.username || user.email;
        }
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    // 1. Carrega Fornecedores
    const fSnap = await getDocs(collection(db, "fornecedores"));
    const sel = document.getElementById("filtroForn");
    sel.innerHTML = '<option value="">Todos os Fornecedores</option>';
    fSnap.forEach(d => {
        dbState.fornecedores[d.id] = d.data().nome;
        sel.innerHTML += `<option value="${d.data().nome}">${d.data().nome}</option>`;
    });

    // 2. Carrega Produtos
    const pSnap = await getDocs(collection(db, "produtos"));
    pSnap.forEach(d => {
        const p = d.data();
        dbState.produtos[d.id] = { nome: p.nome, forn: dbState.fornecedores[p.fornecedorId] || "S/ FORN", cod: (p.codigo || "").toLowerCase() };
    });

    // 3. Restaura Filtros
    document.getElementById("filtroCod").value = localStorage.getItem('f_est_cod') || "";
    document.getElementById("filtroDesc").value = localStorage.getItem('f_est_desc') || "";
    const savedForn = localStorage.getItem('f_est_forn') || "";
    setTimeout(() => { document.getElementById("filtroForn").value = savedForn; window.filtrarEstoque(); }, 200);

    await syncUI();
}

async function syncUI() {
    const eSnap = await getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo")));
    const vSnap = await getDocs(collection(db, "volumes"));
    dbState.enderecos = eSnap.docs.map(d => ({id: d.id, ...d.data()}));
    dbState.volumes = vSnap.docs.map(d => ({id: d.id, ...d.data()}));
    renderPendentes();
    renderEnderecos();
}

function renderEnderecos() {
    const grid = document.getElementById("gridEnderecos");
    grid.innerHTML = "";
    
    dbState.enderecos.forEach(end => {
        const vols = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        const totalVols = vols.reduce((acc, curr) => acc + parseInt(curr.quantidade), 0);
        
        // Dados para busca
        const buscaStr = vols.map(v => {
            const p = dbState.produtos[v.produtoId] || {};
            return `${p.nome} ${p.forn} ${v.descricao} ${p.cod}`;
        }).join(" ").toLowerCase();

        const card = document.createElement("div");
        card.className = "card-endereco";
        card.dataset.busca = buscaStr;
        card.innerHTML = `
            <div class="addr-summary" onclick="this.nextElementSibling.classList.toggle('active')">
                <div>
                    <strong style="color:var(--primary)">R:${end.rua} M:${end.modulo}</strong> 
                    <span style="font-size:11px; margin-left:10px; color:#666;">Nível: ${end.nivel || '0'}</span>
                </div>
                <div style="display:flex; align-items:center; gap:15px;">
                    <span class="btn-action" style="background:#e3f2fd; color:var(--primary); padding:4px 10px; font-size:11px;">
                        ${totalVols} VOLUMES
                    </span>
                    <i class="fas fa-chevron-down" style="font-size:12px; color:#ccc;"></i>
                </div>
            </div>
            <div class="addr-details">
                ${vols.map(v => {
                    const p = dbState.produtos[v.produtoId] || {nome: 'N/A', forn: '---'};
                    return `
                    <div class="item-linha">
                        <div class="fornecedor-badge">${p.forn}</div>
                        <div style="font-size:13px; font-weight:600;">${p.nome}</div>
                        <div style="font-size:12px; color:#555;">${v.quantidade}x ${v.descricao}</div>
                        <div style="display:flex; gap:8px; margin-top:5px;">
                            <button onclick="window.abrirMover('${v.id}')" style="flex:1; font-size:10px; padding:5px;">MOVER</button>
                            <button onclick="window.darSaida('${v.id}')" style="flex:1; font-size:10px; padding:5px; background:var(--danger); color:white; border:none; border-radius:4px;">SAÍDA</button>
                        </div>
                    </div>`;
                }).join('') || '<div style="text-align:center; padding:10px; font-size:11px; color:#999;">Endereço Vazio</div>'}
                <button onclick="window.deletarEndereco('${end.id}')" style="width:100%; background:none; border:none; color:#ff4d4d; font-size:10px; cursor:pointer; margin-top:10px;"><i class="fas fa-trash"></i> EXCLUIR LOCAL</button>
            </div>
        `;
        grid.appendChild(card);
    });
    window.filtrarEstoque();
}

// FILTRO PERSISTENTE E UNIFICADO
window.filtrarEstoque = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fForn = document.getElementById("filtroForn").value.toLowerCase();
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();

    localStorage.setItem('f_est_cod', fCod);
    localStorage.setItem('f_est_forn', document.getElementById("filtroForn").value);
    localStorage.setItem('f_est_desc', fDesc);

    let count = 0;
    document.querySelectorAll(".card-endereco").forEach(card => {
        const b = card.dataset.busca;
        const match = b.includes(fCod) && (fForn === "" || b.includes(fForn)) && b.includes(fDesc);
        card.style.display = match ? "block" : "none";
        if(match) count++;
    });
    document.getElementById("countDisplay").innerText = count;
};

// CRIAÇÃO COM VALIDAÇÃO
window.criarEndereco = async () => {
    const rua = document.getElementById("addRua").value.trim().toUpperCase();
    const mod = document.getElementById("addMod").value.trim();
    const niv = document.getElementById("addNiv").value.trim();

    if(!rua || !mod) return alert("Preencha Rua e Módulo!");
    if(dbState.enderecos.find(e => e.rua === rua && e.modulo === mod && e.nivel === niv)) return alert("Endereço já existe!");

    await addDoc(collection(db, "enderecos"), { rua, modulo: mod, nivel: niv, data: serverTimestamp() });
    syncUI();
};

window.darSaida = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const p = dbState.produtos[vol.produtoId] || {};
    const modal = document.getElementById("modalMaster");
    
    document.getElementById("modalTitle").innerHTML = `<i class="fas fa-box-open"></i> Saída de Estoque`;
    document.getElementById("modalBody").innerHTML = `
        <div style="background:#fff5f5; padding:15px; border-radius:10px; border-left:5px solid var(--danger);">
            <div class="fornecedor-badge">${p.forn}</div>
            <div style="font-weight:bold;">${p.nome}</div>
            <div style="font-size:12px;">${vol.descricao}</div>
        </div>
        <div style="margin-top:20px;">
            <label style="font-size:12px; font-weight:bold;">QTD PARA SAÍDA (Total: ${vol.quantidade}):</label>
            <input type="number" id="qtdSaida" value="1" max="${vol.quantidade}" min="1" style="width:100%; font-size:20px; text-align:center; border:2px solid var(--danger); margin-top:10px;">
        </div>`;
    
    modal.style.display = "flex";
    document.getElementById("btnConfirmar").onclick = async () => {
        const q = parseInt(document.getElementById("qtdSaida").value);
        if(q > 0 && q <= vol.quantidade) {
            await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-q) });
            await addDoc(collection(db, "movimentacoes"), { 
                produto: p.nome, tipo: "Saída", quantidade: q, usuario: document.getElementById("spanUser").innerText, data: serverTimestamp() 
            });
            fecharModal(); syncUI();
        }
    };
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
