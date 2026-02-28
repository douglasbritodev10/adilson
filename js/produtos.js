import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, serverTimestamp, doc, getDoc,
    updateDoc, query, orderBy, deleteDoc, where 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let fornecedoresCache = {};
let userRole = "leitor";
let usernameDB = "Usuário";

onAuthStateChanged(auth, async user => {
    if (user) {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
            const data = userSnap.data();
            usernameDB = data.nomeCompleto || "Usuário";
            userRole = (data.role || "leitor").toLowerCase();
            if(userRole === "admin") document.getElementById("painelCadastro").style.display = "flex";
        }
        document.getElementById("userDisplay").innerHTML = `<i class="fas fa-user"></i> ${usernameDB}`;
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

    // 1. Agrupar volumes por Produto e unificar SKUs iguais
    const mapaVolumes = {};
    vSnap.forEach(d => {
        const v = d.data();
        const pId = v.produtoId;
        const sku = v.codigo || "S/C";
        
        if (!mapaVolumes[pId]) mapaVolumes[pId] = {};
        if (!mapaVolumes[pId][sku]) {
            mapaVolumes[pId][sku] = { desc: v.descricao, qtd: 0, enderecado: !!v.enderecoId };
        }
        mapaVolumes[pId][sku].qtd += (v.quantidade || 0);
        if (v.enderecoId) mapaVolumes[pId][sku].enderecado = true;
    });

    // 2. Renderizar uma linha ÚNICA por produto
    pSnap.forEach(d => {
        const p = d.data();
        const pId = d.id;
        const volumesDoProduto = Object.entries(mapaVolumes[pId] || {});
        const totalGeral = volumesDoProduto.reduce((acc, [sku, data]) => acc + data.qtd, 0);

        // Linha Principal do Produto
        tbody.innerHTML += `
            <tr class="prod-row" data-id="${pId}" data-cod="${p.codigo || ''}" data-forn="${p.fornecedorId}" onclick="window.toggleVols('${pId}')">
                <td style="text-align:center;"><i class="fas fa-chevron-right"></i></td>
                <td>${p.codigo || '---'}</td>
                <td style="color:var(--primary); font-size:12px;">${fornecedoresCache[p.fornecedorId] || "---"}</td>
                <td>${p.nome}</td>
                <td style="text-align:center;"><span class="badge-qty">${totalGeral}</span></td>
                <td style="text-align:right;">
                    <button class="btn btn-sm" style="background:var(--success); color:white;" onclick="event.stopPropagation(); window.modalNovoVolume('${pId}', '${p.nome}')"><i class="fas fa-plus"></i></button>
                </td>
            </tr>
        `;

        // Linhas de Volumes (Filhos) - Escondidas por padrão
        volumesDoProduto.forEach(([sku, data]) => {
            tbody.innerHTML += `
                <tr class="child-row child-${pId}" style="display:none;" data-sku="${sku}">
                    <td></td>
                    <td style="font-size:11px; color:#666;">SKU: ${sku}</td>
                    <td colspan="2" style="padding-left:20px;">${data.desc}</td>
                    <td style="text-align:center; font-weight:bold;">${data.qtd}</td>
                    <td style="text-align:right;">
                        <button class="btn btn-sm" style="background:var(--info); color:white;" onclick="window.movimentar('${pId}','${sku}','${p.nome}','${data.desc}',${data.qtd},'ENTRADA')"><i class="fas fa-arrow-up"></i></button>
                        <button class="btn btn-sm" style="background:var(--danger); color:white;" onclick="window.movimentar('${pId}','${sku}','${p.nome}','${data.desc}',${data.qtd},'SAÍDA')"><i class="fas fa-arrow-down"></i></button>
                    </td>
                </tr>
            `;
        });
    });
}

// Abre/Fecha volumes do produto
window.toggleVols = (pId) => {
    const rows = document.querySelectorAll(`.child-${pId}`);
    const icon = document.querySelector(`tr[data-id="${pId}"] i`);
    rows.forEach(r => r.style.display = (r.style.display === "none" ? "table-row" : "none"));
    if(icon) icon.classList.toggle('fa-chevron-down');
};

// Filtro inteligente (Busca código de produto ou SKU de volume)
window.filtrar = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();
    const fForn = document.getElementById("filtroForn").value;

    document.querySelectorAll(".prod-row").forEach(row => {
        const pId = row.dataset.id;
        const pCod = row.dataset.cod.toLowerCase();
        const pNome = row.innerText.toLowerCase();
        const pForn = row.dataset.forn;

        // Verifica se algum volume interno bate com o SKU pesquisado
        let matchSKU = false;
        document.querySelectorAll(`.child-${pId}`).forEach(vRow => {
            if (fCod && vRow.dataset.sku.toLowerCase().includes(fCod)) matchSKU = true;
        });

        const matchProd = (pCod.includes(fCod) || pNome.includes(fDesc));
        const matchForn = (fForn === "" || pForn === fForn);

        if (matchForn && (matchProd || matchSKU)) {
            row.style.display = "table-row";
            if (fCod && matchSKU) window.toggleVols(pId); // Auto-expande se achar pelo SKU
        } else {
            row.style.display = "none";
        }
    });
};

// Movimentação com a trava de endereçamento que você pediu
window.movimentar = async (pId, sku, pNome, vDesc, qtdAtual, tipo) => {
    const val = prompt(`${tipo}: ${vDesc}\nQuantidade:`);
    if(!val || isNaN(val)) return;
    const qtdInformada = parseInt(val);

    const q = query(collection(db, "volumes"), where("produtoId", "==", pId), where("codigo", "==", sku));
    const vSnap = await getDocs(q);
    
    let volPendente = null;
    let jaEnderecado = false;

    vSnap.forEach(d => {
        if (!d.data().enderecoId) volPendente = { id: d.id, ...d.data() };
        else jaEnderecado = true;
    });

    if (tipo === 'ENTRADA') {
        if (volPendente) {
            await updateDoc(doc(db, "volumes", volPendente.id), { quantidade: volPendente.quantidade + qtdInformada });
        } else {
            await addDoc(collection(db, "volumes"), {
                produtoId: pId, codigo: sku, descricao: vDesc, 
                quantidade: qtdInformada, enderecoId: "", dataAlt: serverTimestamp()
            });
        }
        refresh();
    } else {
        if (jaEnderecado) return alert("ERRO: Produto já endereçado! Dê a saída pela tela de Estoque.");
        if (!volPendente || volPendente.quantidade < qtdInformada) return alert("Estoque insuficiente.");
        
        const novaQtd = volPendente.quantidade - qtdInformada;
        if (novaQtd <= 0) await deleteDoc(doc(db, "volumes", volPendente.id));
        else await updateDoc(doc(db, "volumes", volPendente.id), { quantidade: novaQtd });
        refresh();
    }
};

window.modalNovoVolume = (pId, pNome) => {
    document.getElementById("modalTitle").innerText = `Novo Volume: ${pNome}`;
    document.getElementById("modalBody").innerHTML = `
        <label>SKU</label><input type="text" id="vCod">
        <label>DESCRIÇÃO</label><input type="text" id="vDesc">
        <label>QTD</label><input type="number" id="vQtd" value="1">
    `;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnModalConfirm").onclick = async () => {
        await addDoc(collection(db, "volumes"), {
            produtoId: pId, codigo: document.getElementById("vCod").value,
            descricao: document.getElementById("vDesc").value.toUpperCase(),
            quantidade: parseInt(document.getElementById("vQtd").value),
            enderecoId: "", dataAlt: serverTimestamp()
        });
        window.fecharModal(); refresh();
    };
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
window.limparFiltros = () => { document.querySelectorAll('input').forEach(i=>i.value=""); refresh(); };

document.getElementById("btnSaveProd").onclick = async () => {
    const n = document.getElementById("newNome").value.toUpperCase();
    const c = document.getElementById("newCod").value;
    const f = document.getElementById("selForn").value;
    if(!n || !f) return alert("Preencha Nome e Fornecedor!");
    await addDoc(collection(db, "produtos"), { nome: n, codigo: c, fornecedorId: f });
    refresh();
};
