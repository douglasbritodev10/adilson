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
    const selCadastro = document.getElementById("selForn");
    const selFiltro = document.getElementById("filtroForn");
    
    if(selCadastro) selCadastro.innerHTML = '<option value="">Selecione...</option>';
    if(selFiltro) selFiltro.innerHTML = '<option value="">Todos os Fornecedores</option>';

    fSnap.forEach(d => {
        const nome = d.data().nome;
        fornecedoresCache[d.id] = nome;
        if(selCadastro) selCadastro.innerHTML += `<option value="${d.id}">${nome}</option>`;
        if(selFiltro) selFiltro.innerHTML += `<option value="${nome}">${nome}</option>`;
    });

    // Recuperar filtros do localStorage
    document.getElementById("filtroCod").value = localStorage.getItem('f_prod_cod') || "";
    document.getElementById("filtroDesc").value = localStorage.getItem('f_prod_desc') || "";
    const fornSalvo = localStorage.getItem('f_prod_forn') || "";
    
    // Aguardar carregar o select para aplicar o valor salvo
    setTimeout(() => {
        document.getElementById("filtroForn").value = fornSalvo;
        refresh();
    }, 100);
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
        
        // --- LOGICA DE UNIFICAÇÃO (AGRUPAMENTO) ---
        const prodVols = volumesRaw.filter(v => v.produtoId === pId);
        const totalGeral = prodVols.reduce((acc, curr) => acc + (parseInt(curr.quantidade) || 0), 0);

        const row = document.createElement("tr");
        row.className = "prod-row";
        row.dataset.busca = `${p.codigo} ${fNome} ${p.nome}`.toLowerCase();
        
        row.innerHTML = `
            <td style="text-align:center;"><button class="btn" style="padding:2px 8px;" onclick="toggleVols('${pId}')">+</button></td>
            <td style="font-weight:bold; color:var(--primary)">${fNome}</td>
            <td>${p.nome} <br><small style="color:#888">Cód Base: ${p.codigo || '---'}</small></td>
            <td style="text-align:center;"><span class="badge-qtd">${totalGeral}</span></td>
            <td style="text-align:right;">
                ${userRole === 'admin' ? `
                    <button class="btn" style="background:var(--success); color:white;" onclick="window.abrirModalVolume('${pId}', '${p.nome}')"> + NOVO VOL</button>
                    <button class="btn" style="background:var(--danger); color:white;" onclick="deletar('${pId}', 'produtos', '${p.nome}')"><i class="fas fa-trash"></i></button>
                ` : '<i class="fas fa-lock" style="color:#ccc"></i>'}
            </td>
        `;
        tbody.appendChild(row);

        // Agrupando linhas de volumes para exibição unificada
        // Criamos um mapa para agrupar volumes idênticos
        const agrupados = {};
        prodVols.forEach(v => {
            const chave = `${v.codigo}-${v.descricao}`;
            if(!agrupados[chave]) {
                agrupados[chave] = { ...v, idsOriginais: [v.id], qtdTotal: 0 };
            }
            agrupados[chave].qtdTotal += (parseInt(v.quantidade) || 0);
        });

        Object.values(agrupados).forEach(v => {
            const vRow = document.createElement("tr");
            vRow.className = `vol-row child-${pId}`;
            vRow.innerHTML = `
                <td></td>
                <td colspan="2" style="padding-left:40px;">
                    <i class="fas fa-level-up-alt fa-rotate-90" style="color:#ccc"></i> 
                    <b>${v.codigo || 'S/C'}</b> - ${v.descricao}
                </td>
                <td style="text-align:center; font-weight:bold;">${v.qtdTotal}</td>
                <td style="text-align:right; display:flex; justify-content:flex-end; gap:5px;">
                    <button class="btn" style="background:var(--primary); color:white;" onclick="movimentar('${v.idsOriginais[0]}', 1, 'Entrada', '${v.descricao}')" title="Entrada">+1</button>
                    <button class="btn" style="background:var(--warning); color:white;" onclick="movimentar('${v.idsOriginais[0]}', -1, 'Saída', '${v.descricao}')" title="Saída">-1</button>
                    ${userRole === 'admin' ? `
                        <button class="btn" style="background:var(--gray); color:white;" onclick="window.abrirModalVolume('${pId}', '${p.nome}', '${v.idsOriginais[0]}')"><i class="fas fa-edit"></i></button>
                    ` : ''}
                </td>
            `;
            tbody.appendChild(vRow);
        });
    });
    filtrar();
}

// --- MOVIMENTAÇÃO (Entrada e Saída) ---
window.movimentar = async (volId, qtd, tipo, desc) => {
    // Se for entrada, o volume perde o endereço para cair nos "Pendentes" do estoque
    const updateData = {
        quantidade: increment(qtd),
        ultimaMovimentacao: serverTimestamp()
    };
    
    if (tipo === 'Entrada') {
        updateData.enderecoId = ""; // Fica aguardando endereçamento
    }

    await updateDoc(doc(db, "volumes", volId), updateData);
    
    // Registrar no histórico
    await addDoc(collection(db, "movimentacoes"), {
        tipo: tipo,
        quantidade: Math.abs(qtd),
        produto: desc,
        usuario: usernameDB,
        data: serverTimestamp()
    });

    refresh();
};

// --- MODAL PARA CADASTRO E EDIÇÃO ---
window.abrirModalVolume = async (pId, pNome, volId = null) => {
    const modal = document.getElementById("modalMaster");
    const inputCod = document.getElementById("volCod");
    const inputDesc = document.getElementById("volDesc");
    
    document.getElementById("modalTitle").innerText = volId ? `Editar Volume: ${pNome}` : `Novo Volume: ${pNome}`;
    
    if (volId) {
        const vSnap = await getDoc(doc(db, "volumes", volId));
        const vData = vSnap.data();
        inputCod.value = vData.codigo || "";
        inputDesc.value = vData.descricao || "";
    } else {
        inputCod.value = "";
        inputDesc.value = "";
    }

    modal.style.display = "flex";
    
    document.getElementById("btnConfirmarVol").onclick = async () => {
        const dados = {
            codigo: inputCod.value.trim(),
            descricao: inputDesc.value.trim(),
            ultimaMovimentacao: serverTimestamp()
        };

        if (volId) {
            await updateDoc(doc(db, "volumes", volId), dados);
        } else {
            await addDoc(collection(db, "volumes"), {
                ...dados,
                produtoId: pId,
                quantidade: 0,
                enderecoId: ""
            });
        }
        fecharModal();
        refresh();
    };
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";

window.filtrar = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fForn = document.getElementById("filtroForn").value;
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();

    // Salvar filtros
    localStorage.setItem('f_prod_cod', fCod);
    localStorage.setItem('f_prod_desc', fDesc);
    localStorage.setItem('f_prod_forn', fForn);

    document.querySelectorAll(".prod-row").forEach(row => {
        const texto = row.dataset.busca;
        const matches = texto.includes(fCod) && (fForn === "" || texto.includes(fForn.toLowerCase())) && texto.includes(fDesc);
        row.style.display = matches ? "table-row" : "none";
        
        // Esconder os volumes se o produto estiver escondido
        const pId = row.querySelector('button').onclick.toString().match(/'(.*?)'/)[1];
        document.querySelectorAll(`.child-${pId}`).forEach(vRow => {
            vRow.style.display = matches && vRow.classList.contains('active') ? "table-row" : "none";
        });
    });
};

window.limparFiltros = () => {
    localStorage.removeItem('f_prod_cod');
    localStorage.removeItem('f_prod_desc');
    localStorage.removeItem('f_prod_forn');
    location.reload();
};

window.toggleVols = (pId) => {
    document.querySelectorAll(`.child-${pId}`).forEach(el => el.classList.toggle('active'));
    filtrar(); // Re-aplica visibilidade
};

window.deletar = async (id, tabela, descricao) => {
    if(confirm(`Excluir "${descricao}"?`)){
        await deleteDoc(doc(db, tabela, id));
        refresh();
    }
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

window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
