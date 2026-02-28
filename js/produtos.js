import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, serverTimestamp, doc, getDoc,
    updateDoc, query, orderBy, deleteDoc, where, increment 
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

    // Agrupamento inteligente para evitar duplicidade na visualização
    const dadosAgrupados = {};
    vSnap.forEach(d => {
        const v = d.data();
        const pId = v.produtoId;
        const sku = v.codigo || "S/C";
        
        if (!dadosAgrupados[pId]) dadosAgrupados[pId] = {};
        if (!dadosAgrupados[pId][sku]) {
            dadosAgrupados[pId][sku] = { 
                desc: v.descricao, 
                qtdTotal: 0, 
                qtdPend: 0, 
                temEnderecado: false 
            };
        }
        
        dadosAgrupados[pId][sku].qtdTotal += (v.quantidade || 0);
        if (!v.enderecoId || v.enderecoId === "") {
            dadosAgrupados[pId][sku].qtdPend += (v.quantidade || 0);
        } else {
            dadosAgrupados[pId][sku].temEnderecado = true;
        }
    });

    pSnap.forEach(d => {
        const p = d.data();
        const pId = d.id;
        const volumes = Object.entries(dadosAgrupados[pId] || {});
        const totalProduto = volumes.reduce((acc, [sku, data]) => acc + data.qtdTotal, 0);

        tbody.innerHTML += `
            <tr class="prod-row" data-id="${pId}" data-cod="${p.codigo || ''}" data-forn="${p.fornecedorId}" onclick="window.toggleVols('${pId}')">
                <td style="text-align:center;"><i class="fas fa-chevron-right"></i></td>
                <td>${p.codigo || '---'}</td>
                <td style="color:var(--primary); font-size:12px;">${fornecedoresCache[p.fornecedorId] || "---"}</td>
                <td>${p.nome}</td>
                <td style="text-align:center;"><span class="badge-qty">${totalProduto}</span></td>
                <td style="text-align:right;">
                    <button class="btn btn-sm" style="background:var(--success); color:white;" onclick="event.stopPropagation(); window.modalNovoVolume('${pId}', '${p.nome}')"><i class="fas fa-plus"></i></button>
                </td>
            </tr>
        `;

        volumes.forEach(([sku, data]) => {
            tbody.innerHTML += `
                <tr class="child-row child-${pId}" style="display:none;" data-sku="${sku}">
                    <td></td>
                    <td style="font-size:11px; color:#666;">SKU: ${sku}</td>
                    <td colspan="2" style="padding-left:20px;">${data.desc}</td>
                    <td style="text-align:center; font-weight:bold;">${data.qtdTotal}</td>
                    <td style="text-align:right;">
                        <button class="btn btn-sm" style="background:var(--info); color:white;" onclick="window.movimentar('${pId}','${sku}','${p.nome}','${data.desc}','ENTRADA')"><i class="fas fa-arrow-up"></i></button>
                        <button class="btn btn-sm" style="background:var(--danger); color:white;" onclick="window.movimentar('${pId}','${sku}','${p.nome}','${data.desc}','SAÍDA')"><i class="fas fa-arrow-down"></i></button>
                    </td>
                </tr>
            `;
        });
    });
    window.filtrar(); // Aplica o filtro persistente após carregar
}

window.movimentar = async (pId, sku, pNome, vDesc, tipo) => {
    const qtdStr = prompt(`${tipo}: ${vDesc}\nDigite a quantidade:`);
    if(!qtdStr || isNaN(qtdStr)) return;
    const qtdInf = parseInt(qtdStr);

    const q = query(collection(db, "volumes"), where("produtoId", "==", pId), where("codigo", "==", sku));
    const vSnap = await getDocs(q);
    
    let docPendente = null;
    let possuiEnderecado = false;

    vSnap.forEach(d => {
        const v = d.data();
        if (!v.enderecoId) docPendente = { id: d.id, ...v };
        else possuiEnderecado = true;
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
        // Lógica de Saída com Trava
        if (possuiEnderecado) {
            alert("ERRO: Este produto já possui unidades endereçadas!\nSaída bloqueada por aqui. Por favor, realize a saída pela tela de ENDEREÇAMENTO para manter o controle físico.");
            return;
        }
        if (!docPendente || docPendente.quantidade < qtdInf) {
            alert("Saldo insuficiente em produtos não endereçados.");
            return;
        }
        const novaQtd = docPendente.quantidade - qtdInf;
        if (novaQtd <= 0) await deleteDoc(doc(db, "volumes", docPendente.id));
        else await updateDoc(doc(db, "volumes", docPendente.id), { quantidade: novaQtd });
        refresh();
    }
};

window.filtrar = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();
    
    // Salva para persistência
    localStorage.setItem("f_prod_cod", fCod);
    localStorage.setItem("f_prod_desc", fDesc);

    document.querySelectorAll(".prod-row").forEach(row => {
        const texto = row.innerText.toLowerCase();
        const pId = row.dataset.id;
        const visivel = texto.includes(fCod) && texto.includes(fDesc);
        row.style.display = visivel ? "table-row" : "none";
        
        // Se ocultar o pai, oculta os filhos
        if(!visivel) {
            document.querySelectorAll(`.child-${pId}`).forEach(c => c.style.display = "none");
        }
    });
};

window.toggleVols = (pId) => {
    const rows = document.querySelectorAll(`.child-${pId}`);
    const icon = document.querySelector(`tr[data-id="${pId}"] i`);
    rows.forEach(r => r.style.display = (r.style.display === "none" ? "table-row" : "none"));
    if(icon) icon.classList.toggle('fa-chevron-down');
};

document.getElementById("btnSaveProd").onclick = async () => {
    const n = document.getElementById("newNome").value.toUpperCase();
    const c = document.getElementById("newCod").value;
    const f = document.getElementById("selForn").value;
    if(!n || !f) return alert("Preencha Nome e Fornecedor!");
    await addDoc(collection(db, "produtos"), { nome: n, codigo: c, fornecedorId: f });
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
        document.getElementById("modalMaster").style.display = "none";
        refresh();
    };
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.limparFiltros = () => {
    localStorage.removeItem("f_prod_cod");
    localStorage.removeItem("f_prod_desc");
    location.reload();
};
