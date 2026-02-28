import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, serverTimestamp, doc, getDoc,
    updateDoc, query, orderBy, deleteDoc 
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
            
            // Aplicar permissão no painel de cadastro
            if(userRole === "admin") document.getElementById("painelCadastro").style.display = "flex";
        }
        
        document.getElementById("userDisplay").innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB}`;
        init();
    } else { window.location.href = "index.html"; }
});

async function init() {
    const fSnap = await getDocs(query(collection(db, "fornecedores"), orderBy("nome", "asc")));
    const selCadastro = document.getElementById("selForn");
    const selFiltro = document.getElementById("filtroForn");
    
    selCadastro.innerHTML = '<option value="">Selecione...</option>';
    selFiltro.innerHTML = '<option value="">Todos os Fornecedores</option>';

    fSnap.forEach(d => {
        const nome = d.data().nome;
        fornecedoresCache[d.id] = nome;
        selCadastro.innerHTML += `<option value="${d.id}">${nome}</option>`;
        selFiltro.innerHTML += `<option value="${nome}">${nome}</option>`;
    });

    // Carregar filtros salvos
    document.getElementById("filtroCod").value = localStorage.getItem('f_prod_cod') || "";
    document.getElementById("filtroDesc").value = localStorage.getItem('f_prod_desc') || "";
    refresh();
}

async function refresh() {
    const pSnap = await getDocs(query(collection(db, "produtos"), orderBy("nome", "asc")));
    const vSnap = await getDocs(collection(db, "volumes"));
    
    const volumesByProd = {};
    vSnap.forEach(d => {
        const v = d.data();
        if(!volumesByProd[v.produtoId]) volumesByProd[v.produtoId] = [];
        volumesByProd[v.produtoId].push({id: d.id, ...v});
    });

    const tbody = document.getElementById("tblEstoque");
    tbody.innerHTML = "";

    pSnap.forEach(d => {
        const p = d.data();
        const fNome = fornecedoresCache[p.fornecedorId] || "---";
        const vols = volumesByProd[d.id] || [];

        // Linha do Produto
        const row = document.createElement("tr");
        row.className = "prod-row";
        row.dataset.busca = `${p.codigo} ${fNome} ${p.nome}`.toLowerCase();
        
        row.innerHTML = `
            <td style="text-align:center;"><button class="btn" style="padding:2px 8px;" onclick="toggleVols('${d.id}')">+</button></td>
            <td style="font-weight:bold; color:var(--primary)">${fNome}</td>
            <td><code>${p.codigo || '---'}</code></td>
            <td>${p.nome}</td>
            <td style="text-align:right;">
                ${userRole === 'admin' ? `
                    <button class="btn" style="background:var(--success); color:white; font-size:10px;" onclick="window.abrirModalVolume('${d.id}', '${p.nome}')"> + VOL</button>
                    <button class="btn" style="background:var(--gray); color:white; font-size:10px;" onclick="editarItem('${d.id}', 'produtos', '${p.nome}')"><i class="fas fa-edit"></i></button>
                    <button class="btn" style="background:var(--danger); color:white; font-size:10px;" onclick="deletar('${d.id}', 'produtos', '${p.nome}')"><i class="fas fa-trash"></i></button>
                ` : '<i class="fas fa-lock" style="color:#ccc"></i>'}
            </td>
        `;
        tbody.appendChild(row);

        // Linhas de Volumes
        vols.forEach(v => {
            const vRow = document.createElement("tr");
            vRow.className = `vol-row child-${d.id}`;
            vRow.dataset.busca = `${v.codigo || ''} ${v.descricao}`.toLowerCase();
            vRow.innerHTML = `
                <td></td>
                <td colspan="2" style="text-align:right; font-size:11px; color:#888;">VOLUME ➔</td>
                <td style="font-style:italic;"><strong>${v.codigo || ''}</strong> - ${v.descricao}</td>
                <td style="text-align:right;">
                    ${userRole === 'admin' ? `
                        <button class="btn" style="background:none; color:var(--gray);" onclick="editarItem('${v.id}', 'volumes', '${v.descricao}')"><i class="fas fa-edit"></i></button>
                        <button class="btn" style="background:none; color:var(--danger);" onclick="deletar('${v.id}', 'volumes', '${v.descricao}')"><i class="fas fa-times"></i></button>
                    ` : ''}
                </td>
            `;
            tbody.appendChild(vRow);
        });
    });
    filtrar();
}

// --- FUNÇÕES DE VOLUME (MODAL) ---
window.abrirModalVolume = (pId, pNome) => {
    document.getElementById("modalTitle").innerText = `Novo Volume: ${pNome}`;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("volCod").value = "";
    document.getElementById("volDesc").value = "";
    
    document.getElementById("btnConfirmarVol").onclick = async () => {
        const cod = document.getElementById("volCod").value.trim();
        const desc = document.getElementById("volDesc").value.trim();
        if(!desc) return alert("A descrição é obrigatória!");

        await addDoc(collection(db, "volumes"), { 
            produtoId: pId, 
            codigo: cod, 
            descricao: desc, 
            quantidade: 0, 
            ultimaMovimentacao: serverTimestamp() 
        });
        fecharModal();
        refresh();
    };
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";

// --- FILTROS E PESQUISA ---
window.filtrar = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fForn = document.getElementById("filtroForn").value;
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();

    localStorage.setItem('f_prod_cod', fCod);
    localStorage.setItem('f_prod_desc', fDesc);

    document.querySelectorAll(".prod-row").forEach(row => {
        const texto = row.dataset.busca;
        const matches = texto.includes(fCod) && (fForn === "" || texto.includes(fForn.toLowerCase())) && texto.includes(fDesc);
        row.style.display = matches ? "table-row" : "none";
    });
};

window.limparFiltros = () => {
    document.getElementById("filtroCod").value = "";
    document.getElementById("filtroForn").value = "";
    document.getElementById("filtroDesc").value = "";
    localStorage.removeItem('f_prod_cod');
    localStorage.removeItem('f_prod_desc');
    filtrar();
};

window.toggleVols = (pId) => {
    document.querySelectorAll(`.child-${pId}`).forEach(el => el.classList.toggle('active'));
};

window.editarItem = async (id, tabela, valorAtual) => {
    const novo = prompt("Editar descrição:", valorAtual);
    if (novo && novo !== valorAtual) {
        const campo = tabela === 'produtos' ? 'nome' : 'descricao';
        await updateDoc(doc(db, tabela, id), { [campo]: novo });
        refresh();
    }
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
