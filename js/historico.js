import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, query, orderBy, getDocs, deleteDoc, doc, getDoc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let userRole = "leitor";
let userEmail = "";

// --- AUTH & CONTROLE DE ACESSO ---
onAuthStateChanged(auth, async user => {
    if (user) {
        userEmail = user.email;
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
            const data = userSnap.data();
            userRole = (data.role || "leitor").toLowerCase();
            
            // Regra: Somente Admin e Operador podem entrar. Leitor ou desconhecido é expulso.
            if (userRole !== "admin" && userRole !== "operador") {
                alert("Acesso restrito. Sua conta não tem permissão para ver o histórico.");
                signOut(auth).then(() => window.location.href = "index.html");
                return;
            }

            const userName = data.nomeCompleto || user.email.split('@')[0].toUpperCase();
            document.getElementById("labelUser").innerHTML = `<i class="fas fa-user-circle"></i> ${userName} (${userRole.toUpperCase()})`;
        }
        listarHistorico();
    } else {
        window.location.href = "index.html";
    }
});

document.getElementById("btnLogout").onclick = () => signOut(auth).then(() => window.location.href = "index.html");

// --- LISTAGEM COM FILTRO DE PRIVACIDADE ---
async function listarHistorico() {
    const filtroData = document.getElementById("filtroData").value;
    const filtroTipo = document.getElementById("filtroTipo").value;
    const tbody = document.getElementById("corpoTabela");
    
    tbody.innerHTML = "<tr><td colspan='6' style='text-align:center'>Carregando registros...</td></tr>";

    try {
        const q = query(collection(db, "movimentacoes"), orderBy("data", "desc"));
        const snap = await getDocs(q);
        
        tbody.innerHTML = "";
        let encontrou = false;

        snap.forEach((d) => {
            const h = d.data();
            const dataFormatada = h.data?.toDate ? h.data.toDate().toLocaleString('pt-BR') : '---';
            
            // REGRA DE OURO: 
            // Se for admin, vê tudo. 
            // Se for operador, só vê o que o campo 'usuario' dele (e-mail) condiz.
            const souDono = (h.usuario === userEmail);
            
            if (userRole === "admin" || (userRole === "operador" && souDono)) {
                
                // Filtros de Tela (Data e Tipo)
                const matchData = !filtroData || dataFormatada.includes(filtroData.split('-').reverse().join('/'));
                const matchTipo = filtroTipo === "Todos" || h.tipo === filtroTipo;

                if (matchData && matchTipo) {
                    encontrou = true;
                    
                    // Botão excluir só aparece para admin
                    const btnExcluir = (userRole === "admin") 
                        ? `<button class="btn-delete" onclick="window.excluirRegistro('${d.id}')"><i class="fas fa-trash"></i></button>`
                        : '';

                    tbody.innerHTML += `
                        <tr>
                            <td style="font-size:12px; color:#666">${dataFormatada}</td>
                            <td style="font-weight:500">${h.usuario?.split('@')[0].toUpperCase() || 'SISTEMA'}</td>
                            <td style="font-weight:bold; color:var(--primary)">${h.produto}</td>
                            <td class="tipo-${h.tipo}">${h.tipo}</td>
                            <td>${h.quantidade !== undefined ? h.quantidade + ' un' : '--'}</td>
                            <td style="text-align: right; padding-right:15px;">${btnExcluir}</td>
                        </tr>`;
                }
            }
        });

        if (!encontrou) {
            tbody.innerHTML = "<tr><td colspan='6' style='text-align:center; padding: 20px;'>Nenhum registro encontrado.</td></tr>";
        }

    } catch (e) {
        console.error(e);
        tbody.innerHTML = "<tr><td colspan='6' style='color:red; text-align:center;'>Erro ao carregar histórico.</td></tr>";
    }
}

// --- AÇÕES GLOBAIS ---
window.excluirRegistro = async (id) => {
    if (userRole !== "admin") return alert("Apenas administradores podem excluir registros.");
    
    if (confirm("Deseja remover permanentemente este registro do histórico?")) {
        await deleteDoc(doc(db, "movimentacoes", id));
        listarHistorico();
    }
};

// Eventos
document.getElementById("filtroData").addEventListener("change", listarHistorico);
document.getElementById("filtroTipo").addEventListener("change", listarHistorico);
document.getElementById("btnLimpar").onclick = () => {
    document.getElementById("filtroData").value = "";
    document.getElementById("filtroTipo").value = "Todos";
    listarHistorico();
};
