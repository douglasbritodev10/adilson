import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, deleteDoc, doc, updateDoc, getDoc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let userRole = "leitor";

// --- CONTROLE DE ACESSO ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
            const data = userSnap.data();
            userRole = (data.role || "leitor").toLowerCase();
            
            if (userRole !== "admin") {
                alert("Acesso restrito a administradores.");
                window.location.href = "dashboard.html";
                return;
            }

            const userName = data.nomeCompleto || user.email.split('@')[0].toUpperCase();
            document.getElementById("labelUser").innerHTML = `<i class="fas fa-user-circle"></i> ${userName} (ADMIN)`;
        }
        carregar();
    } else {
        window.location.href = "index.html";
    }
});

// Logout
document.getElementById("btnLogout").onclick = () => signOut(auth).then(() => window.location.href = "index.html");

// --- MÁSCARAS ---
const aplicarMascaraCnpj = (el) => {
    if(!el) return;
    el.addEventListener('input', (e) => {
        let x = e.target.value.replace(/\D/g, '').match(/(\d{0,2})(\d{0,3})(\d{0,3})(\d{0,4})(\d{0,2})/);
        e.target.value = !x[2] ? x[1] : x[1] + '.' + x[2] + '.' + x[3] + '/' + x[4] + (x[5] ? '-' + x[5] : '');
    });
};
aplicarMascaraCnpj(document.getElementById("cnpjF"));
aplicarMascaraCnpj(document.getElementById("editCnpj"));

// --- CRUD ---
async function carregar() {
    const snap = await getDocs(collection(db, "fornecedores"));
    const lista = document.getElementById("listaF");
    lista.innerHTML = "";

    snap.forEach(d => {
        const f = d.data();
        // Importante: Usamos base64 ou passamos o ID para evitar erros de aspas no JSON.stringify dentro do HTML
        const fJson = encodeURIComponent(JSON.stringify(f));
        
        lista.innerHTML += `
            <tr>
                <td style="font-weight:bold; color:var(--primary)">${f.nome}</td>
                <td>${f.cnpj || '---'}</td>
                <td>${f.email || '---'}</td>
                <td>${f.telefone || '---'}</td>
                <td style="text-align: right;">
                    <button class="btn-action" style="background:var(--warning)" onclick="window.abrirEdicao('${d.id}', '${fJson}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-action" style="background:var(--danger)" onclick="window.excluirF('${d.id}', '${f.nome}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>`;
    });
}

document.getElementById("btnSalvarF").onclick = async () => {
    const nome = document.getElementById("nomeF").value.toUpperCase();
    const cnpj = document.getElementById("cnpjF").value;
    const email = document.getElementById("emailF").value.toLowerCase();
    const tel = document.getElementById("telefoneF").value;

    if(!nome) return alert("O nome do fornecedor é obrigatório!");

    await addDoc(collection(db, "fornecedores"), {
        nome, cnpj, email, telefone: tel
    });
    
    limparCampos();
    carregar();
};

// --- FUNÇÕES GLOBAIS (Expostas para o HTML) ---

window.abrirEdicao = (id, fJsonEncoded) => {
    const f = JSON.parse(decodeURIComponent(fJsonEncoded));
    
    document.getElementById("editNome").value = f.nome;
    document.getElementById("editCnpj").value = f.cnpj || "";
    document.getElementById("editEmail").value = f.email || "";
    document.getElementById("editTel").value = f.telefone || "";
    
    document.getElementById("modalEdit").style.display = "flex";
    
    // Configura o botão de salvar do modal
    document.getElementById("btnConfirmarEdit").onclick = async () => {
        await updateDoc(doc(db, "fornecedores", id), {
            nome: document.getElementById("editNome").value.toUpperCase(),
            cnpj: document.getElementById("editCnpj").value,
            email: document.getElementById("editEmail").value.toLowerCase(),
            telefone: document.getElementById("editTel").value
        });
        window.fecharModal();
        carregar();
    };
};

window.fecharModal = () => {
    document.getElementById("modalEdit").style.display = "none";
};

window.excluirF = async (id, nome) => {
    if(confirm(`Deseja remover permanentemente o fornecedor ${nome}?`)) {
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
