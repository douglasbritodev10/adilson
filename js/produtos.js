import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, serverTimestamp, doc, getDoc,
    updateDoc, query, orderBy, deleteDoc, writeBatch 
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

async function registrarMov(tipo, prod, vol, qtd, ant, atu) {
    await addDoc(collection(db, "movimentacoes"), {
        usuario: usernameDB, tipo, produto: prod, volume: vol, 
        quantidade: qtd, anterior: ant, atual: atu, data: serverTimestamp()
    });
}

async function init() {
    const fSnap = await getDocs(query(collection(db, "fornecedores"), orderBy("nome")));
    const selC = document.getElementById("selForn");
    const selF = document.getElementById("filtroForn");
    selC.innerHTML = '<option value="">Escolha o Fornecedor</option>';
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

    // Agrupar e Unificar volumes por SKU dentro de cada Produto
    const produtosMap = {};
    vSnap.forEach(d => {
        const v = d.data();
        const pId = v.produtoId;
        if(!produtosMap[pId]) produtosMap[pId] = {};
        
        // Chave de unificação: Código (SKU)
        const sku = v.codigo || "S/C";
        if(!produtosMap[pId][sku]) {
            produtosMap[pId][sku] = { 
                ids: [d.id], // Guarda os IDs reais do banco para atualizar depois
                codigo: sku,
                descricao: v.descricao,
                quantidade: 0 
            };
        } else {
            produtosMap[pId][sku].ids.push(d.id);
        }
        produtosMap[pId][sku].quantidade += (v.quantidade || 0);
    });

    pSnap.forEach(d => {
        const p = d.data();
        const pId = d.id;
        const volumesUnificados = Object.values(produtosMap[pId] || {});
        const totalGeral = volumesUnificados.reduce((acc, curr) => acc + curr.quantidade, 0);

        tbody.innerHTML += `
            <tr class="prod-row" data-id="${pId}" data-cod="${p.codigo}" data-forn="${p.fornecedorId}" onclick="window.toggleVols('${pId}')">
                <td style="text-align:center;"><i class="fas fa-chevron-right"></i></td>
                <td>${p.codigo || '---'}</td>
                <td style="color:var(--primary); font-size:12px;">${fornecedoresCache[p.fornecedorId] || "---"}</td>
                <td>${p.nome}</td>
                <td style="text-align:center;"><span class="badge-qty">${totalGeral}</span></td>
                <td style="text-align:right;">
                    <button class="btn btn-sm" style="background:var(--success); color:white;" onclick="event.stopPropagation(); window.modalNovoVolume('${pId}', '${p.nome}')"><i class="fas fa-plus"></i></button>
                    ${userRole === 'admin' ? `<button class="btn btn-sm" style="background:var(--warning);" onclick="event.stopPropagation(); window.editarProd('${pId}','${p.nome}','${p.codigo}')"><i class="fas fa-edit"></i></button>` : ''}
                </td>
            </tr>
        `;

        volumesUnificados.forEach(v => {
            tbody.innerHTML += `
                <tr class="child-row child-${pId}" data-sku="${v.codigo}">
                    <td></td>
                    <td style="font-size:11px; color:var(--gray);">SKU: ${v.codigo}</td>
                    <td colspan="2" style="padding-left:20px; color:#555;">${v.descricao}</td>
                    <td style="text-align:center; font-weight:bold;">${v.quantidade}</td>
                    <td style="text-align:right;">
                        <div style="display:flex; gap:5px; justify-content:flex-end;">
                            <button class="btn btn-sm" style="background:var(--info); color:white;" onclick="window.ajustarQtd('${pId}','${v.codigo}','${p.nome}','${v.descricao}',${v.quantidade},'ENTRADA')"><i class="fas fa-arrow-up"></i></button>
                            <button class="btn btn-sm" style="background:var(--danger); color:white;" onclick="window.ajustarQtd('${pId}','${v.codigo}','${p.nome}','${v.descricao}',${v.quantidade},'SAÍDA')"><i class="fas fa-arrow-down"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        });
    });
    window.filtrar();
}

// Lógica de busca refinada
window.filtrar = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fForn = document.getElementById("filtroForn").value;
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();

    document.querySelectorAll(".prod-row").forEach(row => {
        const pId = row.dataset.id;
        const pCod = row.dataset.cod.toLowerCase();
        const pText = row.innerText.toLowerCase();
        const pForn = row.dataset.forn;

        let matchVolume = false;
        let expandir = false;

        document.querySelectorAll(`.child-${pId}`).forEach(vRow => {
            const sku = vRow.dataset.sku.toLowerCase();
            const vText = vRow.innerText.toLowerCase();
            
            const batidaSKU = (fCod !== "" && sku.includes(fCod));
            const batidaDesc = (fDesc !== "" && vText.includes(fDesc));

            if(batidaSKU || batidaDesc) {
                matchVolume = true;
                expandir = true; // Se achou o volume pelo código dele, expande o pai
            }
        });

        const batidaPaiCod = (fCod !== "" && pCod.includes(fCod));
        const batidaPaiDesc = (fDesc !== "" && pText.includes(fDesc));
        const batidaForn = (fForn === "" || pForn === fForn);

        const exibir = batidaForn && (batidaPaiCod || batidaPaiDesc || matchVolume);
        
        row.style.display = exibir ? "table-row" : "none";
        
        // Regra de expansão: se buscou código de volume, abre. Se buscou código de produto, mantém fechado.
        window.toggleVols(pId, expandir);
    });
};

// Ajuste de quantidade unificado (atualiza o primeiro volume encontrado com aquele SKU)
window.ajustarQtd = async (pId, sku, pNome, vDesc, qtdAtual, tipo) => {
    if(userRole === 'leitor') return;
    const val = prompt(`${tipo} - ${vDesc}\nQuantidade:`);
    if(!val || isNaN(val)) return;

    const vSnap = await getDocs(collection(db, "volumes"));
    let docIdParaEditar = null;
    vSnap.forEach(d => {
        if(d.data().produtoId === pId && d.data().codigo === sku) docIdParaEditar = d.id;
    });

    if(docIdParaEditar) {
        const nQtd = (tipo === 'ENTRADA') ? (qtdAtual + parseInt(val)) : (qtdAtual - parseInt(val));
        if(nQtd < 0) return alert("Estoque insuficiente!");
        
        await updateDoc(doc(db, "volumes", docIdParaEditar), { quantidade: nQtd });
        await registrarMov(tipo, pNome, vDesc, val, qtdAtual, nQtd);
        refresh();
    }
};

window.modalNovoVolume = (pId, pNome) => {
    document.getElementById("modalTitle").innerText = `Novo Volume para ${pNome}`;
    document.getElementById("modalBody").innerHTML = `
        <label>SKU (CÓDIGO)</label><input type="text" id="vCod">
        <label>DESCRIÇÃO</label><input type="text" id="vDesc">
        <label>QUANTIDADE</label><input type="number" id="vQtd" value="1">
    `;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnModalConfirm").onclick = async () => {
        const v = {
            produtoId: pId,
            codigo: document.getElementById("vCod").value,
            descricao: document.getElementById("vDesc").value.toUpperCase(),
            quantidade: parseInt(document.getElementById("vQtd").value),
            enderecoId: "", dataAlt: serverTimestamp()
        };
        await addDoc(collection(db, "volumes"), v);
        window.fecharModal(); refresh();
    };
};

window.toggleVols = (pId, force = null) => {
    const rows = document.querySelectorAll(`.child-${pId}`);
    const icon = document.querySelector(`tr[data-id="${pId}"] i`);
    rows.forEach(r => {
        if(force !== null) force ? r.classList.add('active') : r.classList.remove('active');
        else r.classList.toggle('active');
    });
    if(icon && rows[0]) {
        icon.className = rows[0].classList.contains('active') ? "fas fa-chevron-down" : "fas fa-chevron-right";
    }
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
window.limparFiltros = () => { document.querySelectorAll('input').forEach(i => i.value=""); document.querySelector('select').value=""; window.filtrar(); };

document.getElementById("btnSaveProd").onclick = async () => {
    const n = document.getElementById("newNome").value.toUpperCase();
    const c = document.getElementById("newCod").value;
    const f = document.getElementById("selForn").value;
    if(!n || !f) return alert("Preencha os campos!");
    await addDoc(collection(db, "produtos"), { nome: n, codigo: c, fornecedorId: f, dataCad: serverTimestamp() });
    refresh();
};
