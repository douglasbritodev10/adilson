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
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const data = userSnap.data();
            usernameDB = data.nomeCompleto || "USUÁRIO";
            userRole = (data.role || "leitor").toLowerCase();
            if(userRole === "admin") document.getElementById("painelCadastro").style.display = "flex";
        }
        document.getElementById("userDisplay").innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB}`;
        
        // Recuperar Filtros Persistentes
        document.getElementById("filtroCod").value = localStorage.getItem("f_prod_cod") || "";
        document.getElementById("filtroDesc").value = localStorage.getItem("f_prod_desc") || "";
        
        init();
    } else { window.location.href = "index.html"; }
});

async function init() {
    const fSnap = await getDocs(query(collection(db, "fornecedores"), orderBy("nome")));
    const selC = document.getElementById("selForn");
    const selF = document.getElementById("filtroForn");
    
    selC.innerHTML = '<option value="">Fornecedor...</option>';
    selF.innerHTML = '<option value="">Todos os Fornecedores</option>';
    
    fSnap.forEach(d => {
        fornecedoresCache[d.id] = d.data().nome;
        const opt = `<option value="${d.id}">${d.data().nome}</option>`;
        selC.innerHTML += opt; 
        selF.innerHTML += opt;
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

    // MAPA DE UNIFICAÇÃO (Agrupa volumes por Produto -> SKU)
    const mapaProdutos = {};

    vSnap.forEach(d => {
        const v = d.data();
        const pId = v.produtoId;
        const sku = v.codigo || "S/C";
        
        if (!mapaProdutos[pId]) mapaProdutos[pId] = { volumes: {}, totalGeral: 0 };
        
        if (!mapaProdutos[pId].volumes[sku]) {
            mapaProdutos[pId].volumes[sku] = { 
                descricao: v.descricao, 
                qtdTotal: 0,
                possuiEnderecado: false 
            };
        }
        
        mapaProdutos[pId].volumes[sku].qtdTotal += (v.quantidade || 0);
        mapaProdutos[pId].totalGeral += (v.quantidade || 0);
        if (v.enderecoId) mapaProdutos[pId].volumes[sku].possuiEnderecado = true;
    });

    pSnap.forEach(d => {
        const p = d.data();
        const pId = d.id;
        const dados = mapaProdutos[pId] || { volumes: {}, totalGeral: 0 };

        // Linha Principal do Produto
        tbody.innerHTML += `
            <tr class="prod-row" data-id="${pId}" data-cod="${p.codigo || ''}" data-forn="${p.fornecedorId}" onclick="window.toggleVols('${pId}')">
                <td style="text-align:center;"><i class="fas fa-chevron-right"></i></td>
                <td>${p.codigo || '---'}</td>
                <td style="color:var(--primary); font-size:12px;">${fornecedoresCache[p.fornecedorId] || "---"}</td>
                <td>${p.nome}</td>
                <td style="text-align:center;"><span class="badge-qty">${dados.totalGeral}</span></td>
                <td style="text-align:right;">
                    <button class="btn btn-sm" style="background:var(--success); color:white;" onclick="event.stopPropagation(); window.modalNovoVolume('${pId}', '${p.nome}')"><i class="fas fa-plus"></i></button>
                </td>
            </tr>
        `;

        // Linhas de Volumes Unificadas
        Object.entries(dados.volumes).forEach(([sku, vol]) => {
            tbody.innerHTML += `
                <tr class="child-row child-${pId}" style="display:none;" data-sku="${sku}">
                    <td></td>
                    <td style="font-size:11px; color:#666;">SKU: ${sku}</td>
                    <td colspan="2" style="padding-left:20px; color:#444;">${vol.descricao}</td>
                    <td style="text-align:center; font-weight:bold;">${vol.qtdTotal}</td>
                    <td style="text-align:right;">
                        <button class="btn btn-sm" style="background:var(--info); color:white;" onclick="window.movimentar('${pId}','${sku}','${p.nome}','${vol.descricao}','ENTRADA')"><i class="fas fa-arrow-up"></i></button>
                        <button class="btn btn-sm" style="background:var(--danger); color:white;" onclick="window.movimentar('${pId}','${sku}','${p.nome}','${vol.descricao}','SAÍDA')"><i class="fas fa-arrow-down"></i></button>
                    </td>
                </tr>
            `;
        });
    });
    window.filtrar();
}

window.filtrar = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();
    const fForn = document.getElementById("filtroForn").value;
    
    localStorage.setItem("f_prod_cod", fCod);
    localStorage.setItem("f_prod_desc", fDesc);

    document.querySelectorAll(".prod-row").forEach(row => {
        const pId = row.dataset.id;
        const pCod = row.dataset.cod.toLowerCase();
        const pForn = row.dataset.forn;
        const pTexto = row.innerText.toLowerCase();

        // Busca se algum SKU de volume bate com o filtro de código
        let matchSKU = false;
        document.querySelectorAll(`.child-${pId}`).forEach(vRow => {
            if (fCod && vRow.dataset.sku.toLowerCase().includes(fCod)) matchSKU = true;
        });

        const mForn = (fForn === "" || pForn === fForn);
        const mTexto = (pTexto.includes(fDesc) || pCod.includes(fCod) || matchSKU);

        row.style.display = (mForn && mTexto) ? "table-row" : "none";
        
        // Se o pai sumir, fecha os volumes
        if (row.style.display === "none") {
            document.querySelectorAll(`.child-${pId}`).forEach(c => c.style.display = "none");
        }
    });
};

window.movimentar = async (pId, sku, pNome, vDesc, tipo) => {
    if(userRole === 'leitor') return;
    const qtdStr = prompt(`${tipo}: ${vDesc}\nQuantidade:`);
    if(!qtdStr || isNaN(qtdStr)) return;
    const qtdInf = parseInt(qtdStr);

    const q = query(collection(db, "volumes"), where("produtoId", "==", pId), where("codigo", "==", sku));
    const vSnap = await getDocs(q);
    
    let docPendente = null;
    let jaEnderecado = false;

    vSnap.forEach(d => {
        const v = d.data();
        if (!v.enderecoId) docPendente = { id: d.id, ...v };
        else jaEnderecado = true;
    });

    if (tipo === 'ENTRADA') {
        if (docPendente) {
            await updateDoc(doc(db, "volumes", docPendente.id), { quantidade: increment(qtdInf) });
        } else {
            await addDoc(collection(db, "volumes"), {
                produtoId: pId, codigo: sku, descricao: vDesc, 
                quantidade: qtdInf, enderecoId: "", dataAlt: serverTimestamp()
            });
        }
        refresh();
    } else {
        if (jaEnderecado) return alert("SAÍDA BLOQUEADA: Produto já endereçado! Realize a saída pela tela de estoque para liberar o espaço físico.");
        if (!docPendente || docPendente.quantidade < qtdInf) return alert("Saldo insuficiente no estoque 'A Endereçar'.");
        
        const novaQtd = docPendente.quantidade - qtdInf;
        if (novaQtd <= 0) await deleteDoc(doc(db, "volumes", docPendente.id));
        else await updateDoc(doc(db, "volumes", docPendente.id), { quantidade: novaQtd });
        refresh();
    }
};

window.toggleVols = (pId) => {
    const rows = document.querySelectorAll(`.child-${pId}`);
    const icon = document.querySelector(`tr[data-id="${pId}"] i`);
    rows.forEach(r => r.style.display = (r.style.display === "none" ? "table-row" : "none"));
    if(icon) icon.className = rows[0].style.display === "none" ? "fas fa-chevron-right" : "fas fa-chevron-down";
};

document.getElementById("btnSaveProd").onclick = async () => {
    const n = document.getElementById("newNome").value.toUpperCase();
    const c = document.getElementById("newCod").value;
    const f = document.getElementById("selForn").value;
    if(!n || !f) return alert("Preencha Nome e Fornecedor!");
    await addDoc(collection(db, "produtos"), { nome: n, codigo: c, fornecedorId: f, dataCad: serverTimestamp() });
    document.getElementById("newNome").value = "";
    document.getElementById("newCod").value = "";
    refresh();
};

window.modalNovoVolume = (pId, pNome) => {
    document.getElementById("modalTitle").innerText = `Novo Volume: ${pNome}`;
    document.getElementById("modalBody").innerHTML = `
        <label>SKU (CÓDIGO VOLUME)</label><input type="text" id="vCod">
        <label>DESCRIÇÃO VOLUME</label><input type="text" id="vDesc">
        <label>QTD INICIAL</label><input type="number" id="vQtd" value="1">
    `;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnModalConfirm").onclick = async () => {
        const vCod = document.getElementById("vCod").value;
        const vDesc = document.getElementById("vDesc").value.toUpperCase();
        const vQtd = parseInt(document.getElementById("vQtd").value);
        if(!vCod || !vDesc) return alert("Preencha os campos!");
        await addDoc(collection(db, "volumes"), {
            produtoId: pId, codigo: vCod, descricao: vDesc, 
            quantidade: vQtd, enderecoId: "", dataAlt: serverTimestamp()
        });
        window.fecharModal(); refresh();
    };
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.limparFiltros = () => { localStorage.clear(); location.reload(); };
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
