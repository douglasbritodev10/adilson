import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, serverTimestamp, doc, getDoc,
    updateDoc, query, orderBy, deleteDoc, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let fornecedoresCache = {};
let userRole = "leitor";
let usernameDB = "Usuário";

// --- CONTROLO DE ACESSO E LOGIN ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const data = userSnap.data();
            usernameDB = data.nomeCompleto || user.email.split('@')[0].toUpperCase();
            userRole = data.role || "leitor";
            const painel = document.getElementById("painelCadastro");
            if(painel && userRole === "admin") painel.style.display = "flex";
        }
        const display = document.getElementById("userDisplay");
        if (display) display.innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB}`;
        init();
    } else { window.location.href = "index.html"; }
});

async function init() {
    const fSnap = await getDocs(query(collection(db, "fornecedores"), orderBy("nome", "asc")));
    const selFiltro = document.getElementById("filtroForn");
    const selCadastro = document.getElementById("selForn");
    
    if(selFiltro) selFiltro.innerHTML = '<option value="">Todos os Fornecedores</option>';
    fSnap.forEach(d => {
        const nome = d.data().nome;
        fornecedoresCache[d.id] = nome;
        if(selFiltro) selFiltro.innerHTML += `<option value="${nome}">${nome}</option>`;
        if(selCadastro) selCadastro.innerHTML += `<option value="${d.id}">${nome}</option>`;
    });

    // Recuperar filtros guardados para não perder ao dar refresh
    document.getElementById("filtroCod").value = localStorage.getItem('f_prod_cod') || "";
    document.getElementById("filtroDesc").value = localStorage.getItem('f_prod_desc') || "";
    document.getElementById("filtroForn").value = localStorage.getItem('f_prod_forn') || "";
    
    refresh();
}

async function refresh() {
    const pSnap = await getDocs(query(collection(db, "produtos"), orderBy("nome", "asc")));
    const vSnap = await getDocs(collection(db, "volumes"));
    
    const volumesRaw = vSnap.docs.map(d => ({id: d.id, ...d.data()}));
    const tbody = document.getElementById("tblEstoque");
    if(!tbody) return;
    tbody.innerHTML = "";

    pSnap.forEach(d => {
        const pId = d.id;
        const p = d.data();
        const fNome = fornecedoresCache[p.fornecedorId] || "---";
        const prodVols = volumesRaw.filter(v => v.produtoId === pId);
        
        // Unificação de volumes iguais para exibição
        const agrupados = {};
        prodVols.forEach(v => {
            const chave = `${v.codigo}-${v.descricao}`;
            if(!agrupados[chave]) agrupados[chave] = { ...v, idsOriginais: [v.id], qtdTotal: 0 };
            agrupados[chave].qtdTotal += (parseInt(v.quantidade) || 0);
        });

        const totalGeral = prodVols.reduce((acc, curr) => acc + (parseInt(curr.quantidade) || 0), 0);

        const row = document.createElement("tr");
        row.className = "prod-row";
        // Dataset de busca inclui códigos de volumes para busca global
        const codVols = prodVols.map(v => v.codigo).join(" ");
        row.dataset.busca = `${p.codigo} ${fNome} ${p.nome} ${codVols}`.toLowerCase();
        
        row.innerHTML = `
            <td style="text-align:center;"><button class="btn" style="padding:2px 8px;" onclick="toggleVols('${pId}')">+</button></td>
            <td style="font-weight:bold; color:var(--primary)">${fNome}</td>
            <td>${p.nome}</td>
            <td style="text-align:center;"><span class="badge-qtd">${totalGeral}</span></td>
            <td style="text-align:right;">
                ${userRole === 'admin' ? `
                    <button class="btn" style="background:var(--success); color:white;" onclick="window.abrirModalVolume('${pId}', '${p.nome}')"> + NOVO VOL</button>
                    <button class="btn" style="background:var(--danger); color:white;" onclick="deletar('${pId}', 'produtos', '${p.nome}')"><i class="fas fa-trash"></i></button>
                ` : '<i class="fas fa-lock" style="color:#ccc"></i>'}
            </td>
        `;
        tbody.appendChild(row);

        Object.values(agrupados).forEach(v => {
            const vRow = document.createElement("tr");
            vRow.className = `vol-row child-${pId}`;
            vRow.dataset.buscaVolume = `${v.codigo} ${v.descricao}`.toLowerCase();
            vRow.innerHTML = `
                <td></td>
                <td colspan="2" style="padding-left:40px;">
                    <i class="fas fa-box" style="color:#aaa; margin-right:5px;"></i> 
                    <b>${v.codigo || 'S/C'}</b> - ${v.descricao}
                </td>
                <td style="text-align:center; font-weight:bold;">${v.qtdTotal}</td>
                <td style="text-align:right;">
                    <button class="btn" style="background:var(--success); color:white;" onclick="window.abrirModalMovimento('${v.idsOriginais[0]}', 'Entrada', '${v.descricao}')"><i class="fas fa-plus"></i></button>
                    <button class="btn" style="background:var(--warning); color:white;" onclick="window.abrirModalMovimento('${v.idsOriginais[0]}', 'Saída', '${v.descricao}')"><i class="fas fa-minus"></i></button>
                    ${userRole === 'admin' ? `
                        <button class="btn" style="background:var(--gray); color:white;" onclick="window.abrirModalVolume('${pId}', '${p.nome}', '${v.idsOriginais[0]}')"><i class="fas fa-edit"></i></button>
                        <button class="btn" style="background:none; color:var(--danger);" onclick="deletar('${v.idsOriginais[0]}', 'volumes', '${v.descricao}')"><i class="fas fa-trash"></i></button>
                    ` : ''}
                </td>
            `;
            tbody.appendChild(vRow);
        });
    });
    filtrar();
}

// --- MODAL DE MOVIMENTAÇÃO (ENTRADA/SAÍDA COM QTD) ---
window.abrirModalMovimento = (volId, tipo, desc) => {
    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = `${tipo}: ${desc}`;
    document.getElementById("modalBody").innerHTML = `
        <label style="font-size:11px; font-weight:bold;">QUANTIDADE PARA ${tipo.toUpperCase()}:</label>
        <input type="number" id="movQtd" style="width:100%; font-size:20px; text-align:center; margin-top:10px;" value="1" min="1">
    `;
    modal.style.display = "flex";

    document.getElementById("btnConfirmarVol").onclick = async () => {
        const qtd = parseInt(document.getElementById("movQtd").value);
        if(!qtd || qtd <= 0) return alert("Insira uma quantidade válida!");

        const valorFinal = tipo === 'Entrada' ? qtd : -qtd;
        const updateData = { quantidade: increment(valorFinal), ultimaMovimentacao: serverTimestamp() };
        
        // Se for entrada, limpa o endereço para cair no "Aguardando Endereçamento" no estoque
        if (tipo === 'Entrada') updateData.enderecoId = ""; 

        await updateDoc(doc(db, "volumes", volId), updateData);
        await addDoc(collection(db, "movimentacoes"), {
            tipo, quantidade: qtd, produto: desc, usuario: usernameDB, data: serverTimestamp()
        });

        fecharModal();
        refresh();
    };
};

// --- MODAL DE CADASTRO / EDIÇÃO DE VOLUME ---
window.abrirModalVolume = async (pId, pNome, volId = null) => {
    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = volId ? `Editar Volume: ${pNome}` : `Novo Volume: ${pNome}`;
    
    let vCod = "", vDesc = "";
    if (volId) {
        const vSnap = await getDoc(doc(db, "volumes", volId));
        vCod = vSnap.data().codigo || "";
        vDesc = vSnap.data().descricao || "";
    }

    document.getElementById("modalBody").innerHTML = `
        <label style="font-size:11px; font-weight:bold;">CÓDIGO (SKU/EAN):</label>
        <input type="text" id="volCod" style="width:100%; margin-bottom:15px;" value="${vCod}">
        <label style="font-size:11px; font-weight:bold;">DESCRIÇÃO:</label>
        <input type="text" id="volDesc" style="width:100%;" value="${vDesc}">
    `;
    modal.style.display = "flex";

    document.getElementById("btnConfirmarVol").onclick = async () => {
        const dados = {
            codigo: document.getElementById("volCod").value.trim(),
            descricao: document.getElementById("volDesc").value.trim(),
            ultimaMovimentacao: serverTimestamp()
        };

        if (volId) {
            await updateDoc(doc(db, "volumes", volId), dados);
        } else {
            await addDoc(collection(db, "volumes"), { ...dados, produtoId: pId, quantidade: 0, enderecoId: "" });
        }
        fecharModal();
        refresh();
    };
};

// --- FILTRO INTELIGENTE (PRODUTO + VOLUME) ---
window.filtrar = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fForn = document.getElementById("filtroForn").value.toLowerCase();
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();

    localStorage.setItem('f_prod_cod', fCod);
    localStorage.setItem('f_prod_desc', fDesc);
    localStorage.setItem('f_prod_forn', fForn);

    document.querySelectorAll(".prod-row").forEach(row => {
        const textoProd = row.dataset.busca;
        const matchesForn = fForn === "" || textoProd.includes(fForn);
        
        let matchVolume = false;
        const pId = row.querySelector('button').onclick.toString().match(/'(.*?)'/)[1];
        
        document.querySelectorAll(`.child-${pId}`).forEach(vRow => {
            const textoVol = vRow.dataset.buscaVolume;
            const match = (fCod === "" || textoVol.includes(fCod)) && (fDesc === "" || textoVol.includes(fDesc));
            if(match) matchVolume = true;
        });

        const exibir = matchesForn && (textoProd.includes(fCod) && textoProd.includes(fDesc) || matchVolume);
        row.style.display = exibir ? "table-row" : "none";

        document.querySelectorAll(`.child-${pId}`).forEach(vRow => {
            vRow.style.display = (exibir && vRow.classList.contains('active')) ? "table-row" : "none";
        });
    });
};

window.fecharModal = () => {
    document.getElementById("modalMaster").style.display = "none";
    document.getElementById("modalBody").innerHTML = "";
};

window.toggleVols = (pId) => {
    document.querySelectorAll(`.child-${pId}`).forEach(el => el.classList.toggle('active'));
    filtrar();
};

window.deletar = async (id, tabela, desc) => {
    if(userRole !== 'admin') return;
    if(confirm(`Eliminar "${desc}"?`)){
        await deleteDoc(doc(db, tabela, id));
        refresh();
    }
};

window.logout = () => signOut(auth).then(() => window.location.href = "index.html");

window.limparFiltros = () => {
    localStorage.clear();
    location.reload();
};

document.getElementById("btnSaveProd").onclick = async () => {
    const n = document.getElementById("newNome").value;
    const c = document.getElementById("newCod").value;
    const f = document.getElementById("selForn").value;
    if(!n || !f) return alert("Preencha Nome e Fornecedor!");
    await addDoc(collection(db, "produtos"), { nome: n, codigo: c, fornecedorId: f, data: serverTimestamp() });
    document.getElementById("newNome").value = "";
    document.getElementById("newCod").value = "";
    refresh();
};
