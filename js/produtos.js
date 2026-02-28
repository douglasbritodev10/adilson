import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, serverTimestamp, doc, getDoc,
    updateDoc, query, orderBy, deleteDoc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let fornecedoresCache = {};
let userRole = "leitor";
let usernameDB = "Usuário";

// --- VERIFICAÇÃO DE LOGIN E PERMISSÕES ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
            const data = userSnap.data();
            // Pega o nome vindo do primeiro acesso
            usernameDB = data.nomeCompleto || user.email.split('@')[0].toUpperCase();
            userRole = data.role || "leitor";
            
            // Só libera o painel de cadastro se for admin
            const painel = document.getElementById("painelCadastro");
            if(painel && userRole === "admin") painel.style.display = "flex";
        }
        
        // CORREÇÃO DO ERRO DA LINHA 12: Verificação de existência do elemento
        const display = document.getElementById("userDisplay");
        if (display) {
            display.innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB}`;
        }
        
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
    if(!tbody) return;
    tbody.innerHTML = "";

    pSnap.forEach(d => {
        const p = d.data();
        const fNome = fornecedoresCache[p.fornecedorId] || "---";
        const vols = volumesByProd[d.id] || [];

        const row = document.createElement("tr");
        row.className = "prod-row";
        row.dataset.busca = `${p.codigo} ${fNome} ${p.nome}`.toLowerCase();
        
        // Só mostra botões de ação se for admin
        const acoesHTML = userRole === 'admin' ? `
            <button class="btn" style="background:var(--success); color:white; font-size:10px;" onclick="window.abrirModalVolume('${d.id}', '${p.nome}')"> + VOL</button>
            <button class="btn" style="background:var(--gray); color:white; font-size:10px;" onclick="editarItem('${d.id}', 'produtos', '${p.nome}')"><i class="fas fa-edit"></i></button>
            <button class="btn" style="background:var(--danger); color:white; font-size:10px;" onclick="deletar('${d.id}', 'produtos', '${p.nome}')"><i class="fas fa-trash"></i></button>
        ` : '<i class="fas fa-lock" style="color:#ccc"></i>';

        row.innerHTML = `
            <td style="text-align:center;"><button class="btn" style="padding:2px 8px;" onclick="toggleVols('${d.id}')">+</button></td>
            <td style="font-weight:bold; color:var(--primary)">${fNome}</td>
            <td><code>${p.codigo || '---'}</code></td>
            <td>${p.nome}</td>
            <td style="text-align:right;">${acoesHTML}</td>
        `;
        tbody.appendChild(row);

        vols.forEach(v => {
            const vRow = document.createElement("tr");
            vRow.className = `vol-row child-${d.id}`;
            vRow.innerHTML = `
                <td></td>
                <td colspan="2" style="text-align:right; font-size:11px; color:#888;">VOLUME ➔</td>
                <td style="font-style:italic;"><strong>${v.codigo || ''}</strong> - ${v.descricao}</td>
                <td style="text-align:right;">
                    ${userRole === 'admin' ? `
                        <button class="btn" style="background:none; color:var(--danger);" onclick="deletar('${v.id}', 'volumes', '${v.descricao}')"><i class="fas fa-times"></i></button>
                    ` : ''}
                </td>
            `;
            tbody.appendChild(vRow);
        });
    });
}

// --- LOGICA DO MODAL DE VOLUME ---
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

window.filtrar = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fForn = document.getElementById("filtroForn").value.toLowerCase();
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();

    document.querySelectorAll(".prod-row").forEach(row => {
        const texto = row.dataset.busca;
        const matches = texto.includes(fCod) && (fForn === "" || texto.includes(fForn)) && texto.includes(fDesc);
        row.style.display = matches ? "table-row" : "none";
    });
};

window.limparFiltros = () => {
    document.getElementById("filtroCod").value = "";
    document.getElementById("filtroForn").value = "";
    document.getElementById("filtroDesc").value = "";
    filtrar();
};

window.toggleVols = (pId) => {
    document.querySelectorAll(`.child-${pId}`).forEach(el => el.classList.toggle('active'));
};

window.logout = () => signOut(auth).then(() => window.location.href = "index.html");

// Exportando funções para o HTML
window.editarItem = async (id, tabela, valorAtual) => {
    if(userRole !== 'admin') return;
    const novo = prompt("Editar descrição:", valorAtual);
    if (novo && novo !== valorAtual) {
        const campo = tabela === 'produtos' ? 'nome' : 'descricao';
        await updateDoc(doc(db, tabela, id), { [campo]: novo });
        refresh();
    }
};

window.deletar = async (id, tabela, descricao) => {
    if(userRole !== 'admin') return;
    if(confirm(`Excluir "${descricao}"?`)){
        await deleteDoc(doc(db, tabela, id));
        refresh();
    }
};

document.getElementById("btnSaveProd").onclick = async () => {
    if(userRole !== 'admin') return;
    const n = document.getElementById("newNome").value;
    const c = document.getElementById("newCod").value;
    const f = document.getElementById("selForn").value;
    if(!n || !f) return alert("Preencha Nome e Fornecedor!");
    await addDoc(collection(db, "produtos"), { nome: n, codigo: c, fornecedorId: f, data: serverTimestamp() });
    document.getElementById("newNome").value = "";
    document.getElementById("newCod").value = "";
    refresh();
};
