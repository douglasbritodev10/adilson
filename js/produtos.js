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
    const fSnap = await getDocs(query(collection(db, "fornecedores"), orderBy("nome")));
    const sel = document.getElementById("selForn");
    if(sel) sel.innerHTML = '<option value="">Selecionar Fornecedor...</option>';
    
    fSnap.forEach(d => {
        fornecedoresCache[d.id] = d.data().nome;
        if(sel){
            let opt = document.createElement("option");
            opt.value = d.id;
            opt.innerText = d.data().nome;
            sel.appendChild(opt);
        }
    });
    refresh();
}

async function refresh() {
    const pSnap = await getDocs(query(collection(db, "produtos"), orderBy("nome")));
    const vSnap = await getDocs(collection(db, "volumes"));
    
    const volumes = vSnap.docs.map(d => ({id: d.id, ...d.data()}));
    const tbody = document.getElementById("tblEstoque");
    if(!tbody) return;
    tbody.innerHTML = "";

    pSnap.forEach(docP => {
        const p = docP.data();
        const pId = docP.id;
        const pVols = volumes.filter(v => v.produtoId === pId && v.quantidade > 0);
        const total = pVols.reduce((acc, curr) => acc + (curr.quantidade || 0), 0);

        const tr = document.createElement("tr");
        tr.className = "prod-row";
        tr.dataset.nome = p.nome.toLowerCase();
        tr.dataset.cod = (p.codigo || "").toLowerCase();
        tr.innerHTML = `
            <td style="text-align:center; cursor:pointer;" onclick="window.toggleVols('${pId}')">
                <i class="fas fa-chevron-right"></i>
            </td>
            <td>${fornecedoresCache[p.fornecedorId] || "---"}</td>
            <td><strong>${p.nome}</strong><br><small>${p.codigo || "S/C"}</small></td>
            <td style="text-align:center;"><b>${total}</b></td>
            <td style="text-align:right; padding-right:20px;">
                ${userRole !== 'leitor' ? `<button class="btn-action btn-add" onclick="window.adicionarVolume('${pId}')" title="Dar Entrada"><i class="fas fa-plus"></i></button>` : ''}
                ${userRole === 'admin' ? `<button class="btn-action btn-del" onclick="window.deletar('${pId}', 'produtos', '${p.nome}')"><i class="fas fa-trash"></i></button>` : ''}
            </td>
        `;
        tbody.appendChild(tr);

        pVols.forEach(v => {
            const vRow = document.createElement("tr");
            vRow.className = `child-row child-${pId}`;
            vRow.style.display = "none";
            // Verifica se está endereçado ou pendente para exibir um ícone diferente
            const statusIcon = v.enderecoId ? "fa-map-marker-alt" : "fa-clock";
            const statusColor = v.enderecoId ? "#00c853" : "#ffab00";

            vRow.innerHTML = `
                <td></td>
                <td colspan="2" style="padding-left:40px;">
                    <i class="fas ${statusIcon}" style="margin-right:8px; color:${statusColor};" title="${v.enderecoId ? 'Endereçado' : 'Pendente'}"></i>
                    ${v.descricao} <small>(${v.codigo})</small>
                </td>
                <td style="text-align:center;">${v.quantidade}</td>
                <td style="text-align:right; padding-right:20px;">
                    ${userRole === 'admin' ? `<button class="btn-action btn-del" onclick="window.deletar('${v.id}', 'volumes', '${v.descricao}')"><i class="fas fa-times"></i></button>` : ''}
                </td>
            `;
            tbody.appendChild(vRow);
        });
    });
}

// --- FUNÇÃO DE ENTRADA ATUALIZADA (PROFISSIONAL) ---
window.adicionarVolume = async (pId) => {
    // Usamos prompts rápidos para manter o foco na operação
    const cod = prompt("CÓDIGO DO VOLUME / SKU:");
    if (!cod) return;

    const desc = prompt("DESCRIÇÃO DO MATERIAL (Ex: TAMPO DE MESA):");
    if (!desc) return;

    const qtdStr = prompt("QUANTIDADE QUE ESTÁ ENTRANDO:", "1");
    const qtd = parseInt(qtdStr);

    if (isNaN(qtd) || qtd <= 0) {
        alert("Quantidade inválida!");
        return;
    }

    try {
        await addDoc(collection(db, "volumes"), {
            produtoId: pId,
            codigo: cod.trim().toUpperCase(),
            descricao: desc.trim().toUpperCase(),
            quantidade: qtd,
            enderecoId: "", // Vazio para cair na lista de "Pendentes" do Estoque
            dataEntrada: serverTimestamp(),
            movimentadoPor: usernameDB
        });

        alert("Entrada registrada com sucesso!\nO material aguarda endereçamento na página de Estoque.");
        refresh();
    } catch (e) {
        console.error("Erro na entrada:", e);
        alert("Erro técnico ao registrar entrada.");
    }
};

window.filtrar = () => {
    const fCod = document.getElementById("filterCod").value.toLowerCase();
    const fDesc = document.getElementById("filterDesc").value.toLowerCase();
    
    document.querySelectorAll(".prod-row").forEach(row => {
        const pId = row.innerHTML.split('window.toggleVols(\'')[1].split('\'')[0];
        const textoProd = row.dataset.nome + " " + row.dataset.cod;
        
        let matchVolume = false;
        document.querySelectorAll(`.child-${pId}`).forEach(vRow => {
            if(vRow.innerText.toLowerCase().includes(fCod) || vRow.innerText.toLowerCase().includes(fDesc)) matchVolume = true;
        });

        const exibir = (textoProd.includes(fCod) && textoProd.includes(fDesc) || matchVolume);
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
    await addDoc(collection(db, "produtos"), {
        nome: n, codigo: c, fornecedorId: f, dataCriacao: serverTimestamp()
    });
    document.getElementById("newNome").value = "";
    document.getElementById("newCod").value = "";
    refresh();
};
