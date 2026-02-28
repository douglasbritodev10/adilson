import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, serverTimestamp, doc, getDoc,
    updateDoc, query, orderBy, deleteDoc, increment 
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
            userRole = data.role || "leitor";
            if(userRole === "admin") document.getElementById("painelCadastro").style.display = "flex";
        }
        document.getElementById("userDisplay").innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB} (${userRole.toUpperCase()})`;
        
        // Recuperar Filtros
        document.getElementById("filtroCod").value = localStorage.getItem("f_cod") || "";
        document.getElementById("filtroDesc").value = localStorage.getItem("f_desc") || "";
        
        init();
    } else { window.location.href = "index.html"; }
});

// Registrar log na coleção movimentacoes
async function registrarMov(tipo, prodNome, volDesc, qtd, anterior, atual) {
    await addDoc(collection(db, "movimentacoes"), {
        usuario: usernameDB,
        tipo: tipo, // "ENTRADA", "SAÍDA", "EDIÇÃO", "EXCLUSÃO"
        produto: prodNome,
        volume: volDesc,
        quantidade: qtd,
        estoqueAnterior: anterior,
        estoqueAtual: atual,
        data: serverTimestamp()
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

    selF.value = localStorage.getItem("f_forn") || "";
    refresh();
}

async function refresh() {
    const [pSnap, vSnap] = await Promise.all([
        getDocs(query(collection(db, "produtos"), orderBy("nome"))),
        getDocs(collection(db, "volumes"))
    ]);
    
    const tbody = document.getElementById("tblEstoque");
    tbody.innerHTML = "";

    const volumesPorProd = {};
    vSnap.forEach(d => {
        const v = d.data();
        if(!volumesPorProd[v.produtoId]) volumesPorProd[v.produtoId] = [];
        volumesPorProd[v.produtoId].push({id: d.id, ...v});
    });

    pSnap.forEach(d => {
        const p = d.data();
        const pId = d.id;
        const vols = volumesPorProd[pId] || [];
        // SOMA GLOBAL: Soma todos os volumes desse produto, independente de endereço
        const totalGeral = vols.reduce((acc, curr) => acc + (curr.quantidade || 0), 0);

        tbody.innerHTML += `
            <tr class="prod-row" data-id="${pId}" data-forn="${p.fornecedorId}">
                <td onclick="window.toggleVols('${pId}')" style="cursor:pointer; text-align:center;"><i class="fas fa-chevron-right"></i></td>
                <td style="font-weight:bold;">${p.codigo || '---'}</td>
                <td style="color:var(--primary); font-size:12px;">${fornecedoresCache[p.fornecedorId] || "---"}</td>
                <td>${p.nome}</td>
                <td style="text-align:center;"><b style="background:#ddd; padding:2px 8px; border-radius:10px;">${totalGeral}</b></td>
                <td style="text-align:right;">
                    <button class="btn btn-sm" style="background:var(--success); color:white;" onclick="window.modalVolume('${pId}', '${p.nome}')"><i class="fas fa-plus"></i> NOVO VOL</button>
                    ${userRole === 'admin' ? `<button class="btn btn-sm" style="background:var(--warning);" onclick="window.editarProd('${pId}','${p.nome}','${p.codigo}')"><i class="fas fa-edit"></i></button>` : ''}
                </td>
            </tr>
        `;

        vols.forEach(v => {
            tbody.innerHTML += `
                <tr class="child-row child-${pId}" data-sku="${v.codigo}">
                    <td></td>
                    <td style="font-size:11px; color:var(--gray);">SKU: ${v.codigo}</td>
                    <td colspan="2" style="padding-left:20px;">${v.descricao}</td>
                    <td style="text-align:center; font-weight:bold; color:var(--primary);">${v.quantidade}</td>
                    <td style="text-align:right;">
                        <div style="display:flex; gap:5px; justify-content:flex-end;">
                            <button class="btn btn-sm" style="background:var(--info); color:white;" onclick="window.movimentar('${v.id}','${p.nome}','${v.descricao}',${v.quantidade},'ENTRADA')" title="Entrada"><i class="fas fa-arrow-up"></i></button>
                            <button class="btn btn-sm" style="background:var(--danger); color:white;" onclick="window.movimentar('${v.id}','${p.nome}','${v.descricao}',${v.quantidade},'SAÍDA')" title="Saída"><i class="fas fa-arrow-down"></i></button>
                            ${userRole === 'admin' ? `
                                <button class="btn btn-sm" style="background:var(--gray); color:white;" onclick="window.editarVol('${v.id}','${v.descricao}','${v.codigo}')"><i class="fas fa-edit"></i></button>
                                <button class="btn btn-sm" style="background:black; color:white;" onclick="window.deletarItem('${v.id}', 'volumes', '${v.descricao}')"><i class="fas fa-trash"></i></button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
        });
    });
    window.filtrar();
}

// --- LÓGICA DE MOVIMENTAÇÃO (ENTRADA/SAÍDA) ---
window.movimentar = async (id, pNome, vDesc, qtdAtual, tipo) => {
    if(userRole === 'leitor') return alert("Acesso negado.");
    const val = prompt(`${tipo} no volume: ${vDesc}\nQtd Atual: ${qtdAtual}\nDigite a quantidade:`);
    if(!val || isNaN(val)) return;
    
    const qtdInformada = parseInt(val);
    let novaQtd = (tipo === 'ENTRADA') ? (qtdAtual + qtdInformada) : (qtdAtual - qtdInformada);

    if(novaQtd < 0) return alert("Estoque insuficiente!");

    await updateDoc(doc(db, "volumes", id), { quantidade: novaQtd });
    await registrarMov(tipo, pNome, vDesc, qtdInformada, qtdAtual, novaQtd);
    
    refresh();
};

window.filtrar = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fForn = document.getElementById("filtroForn").value;
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();

    localStorage.setItem("f_cod", fCod);
    localStorage.setItem("f_forn", fForn);
    localStorage.setItem("f_desc", fDesc);

    document.querySelectorAll(".prod-row").forEach(row => {
        const pId = row.dataset.id;
        const textoProd = row.innerText.toLowerCase();
        const fornId = row.dataset.forn;
        
        let matchSKU = false;
        document.querySelectorAll(`.child-${pId}`).forEach(vRow => {
            if(vRow.dataset.sku.toLowerCase().includes(fCod) && fCod !== "") matchSKU = true;
        });

        const exibir = (fForn === "" || fornId === fForn) && 
                       (textoProd.includes(fDesc) || matchSKU) &&
                       (textoProd.includes(fCod) || matchSKU);
        
        row.style.display = exibir ? "table-row" : "none";
        if(exibir && (fCod !== "" || fDesc !== "")) window.toggleVols(pId, true);
    });
};

window.toggleVols = (pId, forceOpen = false) => {
    document.querySelectorAll(`.child-${pId}`).forEach(el => {
        if(forceOpen) el.classList.add('active');
        else el.classList.toggle('active');
    });
};

window.modalVolume = (pId, pNome) => {
    document.getElementById("modalTitle").innerText = `Novo Volume: ${pNome}`;
    document.getElementById("modalBody").innerHTML = `
        <label>SKU (Cód. Volume):</label><input type="text" id="vCod">
        <label>Descrição:</label><input type="text" id="vDesc">
        <label>Qtd Inicial:</label><input type="number" id="vQtd" value="1">
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
        await registrarMov("CADASTRO", pNome, v.descricao, v.quantidade, 0, v.quantidade);
        window.fecharModal(); refresh();
    };
};

window.deletarItem = async (id, col, desc) => {
    if(confirm(`Excluir permanentemente "${desc}"?`)) {
        await deleteDoc(doc(db, col, id));
        refresh();
    }
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
window.limparFiltros = () => { localStorage.clear(); location.reload(); };

document.getElementById("btnSaveProd").onclick = async () => {
    const n = document.getElementById("newNome").value.toUpperCase();
    const c = document.getElementById("newCod").value;
    const f = document.getElementById("selForn").value;
    if(!n || !f) return alert("Preencha os campos!");
    await addDoc(collection(db, "produtos"), { nome: n, codigo: c, fornecedorId: f, dataCad: serverTimestamp() });
    refresh();
};
