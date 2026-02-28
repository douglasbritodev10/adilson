import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, serverTimestamp, doc, getDoc,
    updateDoc, query, orderBy, deleteDoc, increment, where 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let fornecedoresCache = {};
let userRole = "leitor";
let usernameDB = "Usuário";

onAuthStateChanged(auth, async user => {
    if (user) {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
            const d = userSnap.data();
            usernameDB = d.nomeCompleto || "Usuário";
            userRole = (d.role || "leitor").toLowerCase();
            if(userRole === "admin") document.getElementById("painelCadastro").style.display = "flex";
        }
        document.getElementById("userDisplay").innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB}`;
        
        // Restaurar Filtros
        document.getElementById("filtroForn").value = localStorage.getItem("f_forn") || "";
        document.getElementById("filtroCod").value = localStorage.getItem("f_cod") || "";
        document.getElementById("filtroDesc").value = localStorage.getItem("f_desc") || "";
        
        init();
    } else { window.location.href = "index.html"; }
});

async function init() {
    const fSnap = await getDocs(query(collection(db, "fornecedores"), orderBy("nome")));
    const selC = document.getElementById("selForn");
    const selF = document.getElementById("filtroForn");
    selC.innerHTML = '<option value="">Fornecedor...</option>';
    selF.innerHTML = '<option value="">Todos Fornecedores</option>';
    fSnap.forEach(d => {
        fornecedoresCache[d.id] = d.data().nome;
        const opt = `<option value="${d.id}">${d.data().nome}</option>`;
        selC.innerHTML += opt; selF.innerHTML += opt;
    });
    refresh();
}

async function refresh() {
    const [pSnap, vSnap] = await Promise.all([
        getDocs(query(collection(db, "produtos"), orderBy("nome"))),
        getDocs(collection(db, "volumes"))
    ]);
    
    const tbody = document.getElementById("tblEstoque");
    tbody.innerHTML = "";
    const mapa = {};

    // UNIFICAÇÃO: Agrupa volumes por SKU para não repetir linhas
    vSnap.forEach(d => {
        const v = d.data();
        const pId = v.produtoId;
        const sku = v.codigo || "S/C";
        if (!mapa[pId]) mapa[pId] = { vols: {}, totalProd: 0 };
        if (!mapa[pId].vols[sku]) {
            mapa[pId].vols[sku] = { desc: v.descricao, qtd: 0, enderecado: false };
        }
        mapa[pId].vols[sku].qtd += v.quantidade;
        mapa[pId].totalProd += v.quantidade;
        if (v.enderecoId) mapa[pId].vols[sku].enderecado = true;
    });

    pSnap.forEach(d => {
        const p = d.data();
        const pId = d.id;
        const dados = mapa[pId] || { vols: {}, totalProd: 0 };

        tbody.innerHTML += `
            <tr class="prod-row" data-id="${pId}" data-cod="${p.codigo}" data-forn="${p.fornecedorId}">
                <td style="text-align:center;" onclick="window.toggleVols('${pId}')"><i class="fas fa-chevron-right"></i></td>
                <td>${p.codigo || '---'}</td>
                <td style="color:var(--primary); font-size:12px;">${fornecedoresCache[p.fornecedorId] || '---'}</td>
                <td style="font-weight:bold;">${p.nome}</td>
                <td style="text-align:center;"><span class="badge-qty">${dados.totalProd}</span></td>
                <td style="text-align:right;">
                    <button class="btn btn-sm" style="color:var(--success)" onclick="window.modalNovoVolume('${pId}', '${p.nome}')"><i class="fas fa-plus-circle"></i></button>
                    <button class="btn btn-sm" style="color:var(--info)" onclick="window.modalEditarProd('${pId}', '${p.nome}', '${p.codigo}')"><i class="fas fa-edit"></i></button>
                    <button class="btn btn-sm" style="color:var(--danger)" onclick="window.excluirProduto('${pId}', '${p.nome}')"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `;

        Object.entries(dados.vols).forEach(([sku, vol]) => {
            tbody.innerHTML += `
                <tr class="child-row child-${pId}" data-sku="${sku}">
                    <td></td>
                    <td style="font-size:11px; color:#999;">SKU: ${sku}</td>
                    <td colspan="2" style="padding-left:30px; font-style:italic; color:#555;">${vol.desc}</td>
                    <td style="text-align:center; font-weight:bold;">${vol.qtd}</td>
                    <td style="text-align:right;">
                        <button class="btn btn-sm" onclick="window.modalMovimentar('${pId}','${sku}','${vol.desc}','ENTRADA')"><i class="fas fa-arrow-up"></i></button>
                        <button class="btn btn-sm" onclick="window.modalMovimentar('${pId}','${sku}','${vol.desc}','SAÍDA')"><i class="fas fa-arrow-down"></i></button>
                        <button class="btn btn-sm" style="color:var(--gray)" onclick="window.modalEditarVolume('${pId}','${sku}','${vol.desc}')"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-sm" style="color:var(--danger)" onclick="window.excluirVolume('${pId}','${sku}')"><i class="fas fa-trash-alt"></i></button>
                    </td>
                </tr>
            `;
        });
    });
    window.filtrar(true);
}

// FILTRO PERSISTENTE E DINÂMICO
window.filtrar = (silencioso = false) => {
    const fForn = document.getElementById("filtroForn").value;
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();

    localStorage.setItem("f_forn", fForn);
    localStorage.setItem("f_cod", fCod);
    localStorage.setItem("f_desc", fDesc);

    document.querySelectorAll(".prod-row").forEach(row => {
        const pId = row.dataset.id;
        const pCod = (row.dataset.cod || "").toLowerCase();
        const pForn = row.dataset.forn;
        const pNome = row.innerText.toLowerCase();

        let mVol = false;
        document.querySelectorAll(`.child-${pId}`).forEach(vRow => {
            const sku = vRow.dataset.sku.toLowerCase();
            const text = vRow.innerText.toLowerCase();
            const match = (fCod && sku.includes(fCod)) || (fDesc && text.includes(fDesc));
            if(match) { mVol = true; vRow.style.display = "table-row"; }
            else vRow.style.display = "none";
        });

        const mForn = !fForn || pForn === fForn;
        const mProd = pCod.includes(fCod) || pNome.includes(fDesc);
        const exibir = mForn && (mProd || mVol);

        row.style.display = exibir ? "table-row" : "none";
        if(mVol && !silencioso) window.toggleVols(pId, true);
    });
};

// CRUD PRODUTOS
window.modalEditarProd = (id, nome, cod) => {
    openModal("Editar Produto", `
        <label>Código:</label><input type="text" id="eCod" value="${cod}">
        <label>Nome:</label><input type="text" id="eNome" value="${nome}">
    `, async () => {
        await updateDoc(doc(db, "produtos", id), {
            nome: document.getElementById("eNome").value.toUpperCase(),
            codigo: document.getElementById("eCod").value
        });
        window.fecharModal(); refresh();
    });
};

window.excluirProduto = async (id, nome) => {
    if(!confirm(`Excluir o produto "${nome}" e todos os volumes dele?`)) return;
    await deleteDoc(doc(db, "produtos", id));
    const q = query(collection(db, "volumes"), where("produtoId", "==", id));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map(v => deleteDoc(doc(db, "volumes", v.id))));
    refresh();
};

// CRUD VOLUMES
window.modalNovoVolume = (pId, pNome) => {
    openModal(`Novo Volume para ${pNome}`, `
        <label>SKU:</label><input type="text" id="vCod">
        <label>Descrição:</label><input type="text" id="vDesc">
        <label>Qtd Inicial:</label><input type="number" id="vQtd" value="1">
    `, async () => {
        await addDoc(collection(db, "volumes"), {
            produtoId: pId, codigo: document.getElementById("vCod").value,
            descricao: document.getElementById("vDesc").value.toUpperCase(),
            quantidade: parseInt(document.getElementById("vQtd").value),
            enderecoId: "", dataAlt: serverTimestamp()
        });
        window.fecharModal(); refresh();
    });
};

window.modalEditarVolume = (pId, sku, desc) => {
    openModal("Editar SKU/Descrição", `
        <label>Novo SKU:</label><input type="text" id="vSKU" value="${sku}">
        <label>Nova Descrição:</label><input type="text" id="vD" value="${desc}">
    `, async () => {
        const q = query(collection(db, "volumes"), where("produtoId", "==", pId), where("codigo", "==", sku));
        const snap = await getDocs(q);
        const batch = snap.docs.map(d => updateDoc(doc(db, "volumes", d.id), {
            codigo: document.getElementById("vSKU").value,
            descricao: document.getElementById("vD").value.toUpperCase()
        }));
        await Promise.all(batch);
        window.fecharModal(); refresh();
    });
};

window.excluirVolume = async (pId, sku) => {
    if(!confirm(`Deseja remover o volume ${sku} do sistema?`)) return;
    const q = query(collection(db, "volumes"), where("produtoId", "==", pId), where("codigo", "==", sku));
    const snap = await getDocs(q);
    await Promise.all(snap.docs.map(v => deleteDoc(doc(db, "volumes", v.id))));
    refresh();
};

// MOVIMENTAÇÃO SEM RECARREGAR
window.modalMovimentar = async (pId, sku, desc, tipo) => {
    openModal(`${tipo}: ${desc}`, `
        <label>Quantidade:</label><input type="number" id="mQtd" value="1">
    `, async () => {
        const qtd = parseInt(document.getElementById("mQtd").value);
        const q = query(collection(db, "volumes"), where("produtoId", "==", pId), where("codigo", "==", sku));
        const snap = await getDocs(q);
        
        let pendente = null; let ender = false;
        snap.forEach(d => { if(!d.data().enderecoId) pendente = d; else ender = true; });

        if(tipo === 'ENTRADA') {
            if(pendente) await updateDoc(doc(db, "volumes", pendente.id), { quantidade: increment(qtd) });
            else await addDoc(collection(db, "volumes"), { produtoId: pId, codigo: sku, descricao: desc, quantidade: qtd, enderecoId: "", dataAlt: serverTimestamp() });
        } else {
            if(ender) return alert("ERRO: Saída bloqueada! Produto endereçado deve sair pela tela de estoque.");
            if(!pendente || pendente.data().quantidade < qtd) return alert("Saldo insuficiente.");
            const novo = pendente.data().quantidade - qtd;
            if(novo <= 0) await deleteDoc(doc(db, "volumes", pendente.id));
            else await updateDoc(doc(db, "volumes", pendente.id), { quantidade: novo });
        }
        window.fecharModal(); refresh();
    });
};

// AUXILIARES
function openModal(title, body, action) {
    document.getElementById("modalTitle").innerText = title;
    document.getElementById("modalBody").innerHTML = body;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnModalConfirm").onclick = action;
}

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";

window.toggleVols = (pId, force = false) => {
    const rows = document.querySelectorAll(`.child-${pId}`);
    const icon = document.querySelector(`tr[data-id="${pId}"] i`);
    rows.forEach(r => r.classList.toggle('active', force || !r.classList.contains('active')));
    if(icon) icon.className = rows[0].classList.contains('active') ? "fas fa-chevron-down" : "fas fa-chevron-right";
};

document.getElementById("btnSaveProd").onclick = async () => {
    const n = document.getElementById("newNome").value.toUpperCase();
    const c = document.getElementById("newCod").value;
    const f = document.getElementById("selForn").value;
    if(!n || !f) return alert("Preencha Nome e Fornecedor!");
    await addDoc(collection(db, "produtos"), { nome: n, codigo: c, fornecedorId: f, dataCad: serverTimestamp() });
    document.getElementById("newNome").value = ""; document.getElementById("newCod").value = "";
    refresh();
};

window.limparFiltros = () => { localStorage.clear(); location.reload(); };
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
