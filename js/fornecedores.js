import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, deleteDoc, doc, updateDoc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// --- AUTH & SAUDAÇÃO ---
onAuthStateChanged(auth, user => {
    if (user) {
        document.getElementById("labelUser").innerText = `Olá, ${user.email.split('@')[0].toUpperCase()}`;
        carregar();
    } else {
        window.location.href = "index.html";
    }
});

document.getElementById("btnLogout").onclick = () => signOut(auth).then(() => window.location.href = "index.html");

// --- MÁSCARAS DE INPUT ---
const inputCnpj = document.getElementById("cnpjF");
const inputTel = document.getElementById("telefoneF");

inputCnpj.addEventListener('input', (e) => {
    let x = e.target.value.replace(/\D/g, '').match(/(\d{0,2})(\d{0,3})(\d{0,3})(\d{0,4})(\d{0,2})/);
    e.target.value = !x[2] ? x[1] : x[1] + '.' + x[2] + '.' + x[3] + '/' + x[4] + (x[5] ? '-' + x[5] : '');
});

inputTel.addEventListener('input', (e) => {
    let x = e.target.value.replace(/\D/g, '').match(/(\d{0,2})(\d{0,5})(\d{0,4})/);
    e.target.value = !x[2] ? x[1] : '(' + x[1] + ') ' + x[2] + (x[3] ? '-' + x[3] : '');
});

// --- CRUD ---

const carregar = async () => {
    const snap = await getDocs(collection(db, "fornecedores"));
    const tbody = document.getElementById("listaF");
    tbody.innerHTML = "";
    
    snap.forEach(d => {
        const f = d.data();
        tbody.innerHTML += `
            <tr>
                <td style="font-weight:bold">${f.nome}</td>
                <td>${f.cnpj}</td>
                <td>${f.email}</td>
                <td>${f.telefone}</td>
                <td style="text-align: right;">
                    <button class="btn-action" style="background:var(--warning)" onclick="window.editarF('${d.id}', '${f.nome}')">✎</button>
                    <button class="btn-action" style="background:var(--danger)" onclick="window.excluirF('${d.id}')">✕</button>
                </td>
            </tr>`;
    });
};

document.getElementById("btnSalvarF").onclick = async () => {
    const nome = document.getElementById("nomeF").value;
    const cnpj = document.getElementById("cnpjF").value;
    const email = document.getElementById("emailF").value;
    const tel = document.getElementById("telefoneF").value;

    if(!nome) return alert("O nome do fornecedor é obrigatório!");

    await addDoc(collection(db, "fornecedores"), {
        nome, cnpj, email, telefone: tel
    });
    
    limparCampos();
    carregar();
};

window.editarF = async (id, nomeAtual) => {
    const novoNome = prompt("Novo nome para o fornecedor:", nomeAtual);
    if(novoNome && novoNome !== nomeAtual) {
        await updateDoc(doc(db, "fornecedores", id), { nome: novoNome });
        carregar();
    }
};

window.excluirF = async (id) => {
    if(confirm("Deseja remover este fornecedor?")) {
        await deleteDoc(doc(db, "fornecedores", id));
        carregar();
    }
};

function limparCampos() {
    document.getElementById("nomeF").value = "";
    document.getElementById("cnpjF").value = "";
    document.getElementById("emailF").value = "";
    document.getElementById("telefoneF").value = "";
}
