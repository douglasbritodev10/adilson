import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, query, orderBy, getDocs, deleteDoc, doc 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// --- AUTH & SAUDAÇÃO ---
onAuthStateChanged(auth, user => {
    if (user) {
        document.getElementById("labelUser").innerText = `Olá, ${user.email.split('@')[0].toUpperCase()}`;
        listarHistorico();
    } else {
        window.location.href = "index.html";
    }
});

document.getElementById("btnLogout").onclick = () => signOut(auth).then(() => window.location.href = "index.html");

// --- FUNÇÃO PRINCIPAL ---
async function listarHistorico() {
    const filtroData = document.getElementById("filtroData").value; // Formato YYYY-MM-DD
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
            const dataObjeto = h.data ? h.data.toDate() : null;
            
            // Lógica de Filtro de Data
            let dataMatch = true;
            if (filtroData && dataObjeto) {
                const dataString = dataObjeto.toISOString().split('T')[0]; // Converte para YYYY-MM-DD
                dataMatch = (dataString === filtroData);
            }

            // Lógica de Filtro de Tipo
            const tipoMatch = (filtroTipo === "Todos" || h.tipo === filtroTipo);

            if (dataMatch && tipoMatch) {
                encontrou = true;
                const dataFormatada = dataObjeto ? dataObjeto.toLocaleString('pt-BR') : "N/A";
                
                tbody.innerHTML += `
                    <tr>
                        <td>${dataFormatada}</td>
                        <td style="color:#666">${h.usuario || 'Sistema'}</td>
                        <td style="font-weight:bold">${h.produto}</td>
                        <td class="tipo-${h.tipo}">${h.tipo}</td>
                        <td>${h.quantidade !== undefined ? h.quantidade + ' un' : '--'}</td>
                        <td style="text-align: right;">
                            <button class="btn-delete" onclick="window.excluirRegistro('${d.id}')">Excluir</button>
                        </td>
                    </tr>`;
            }
        });

        if (!encontrou) {
            tbody.innerHTML = "<tr><td colspan='6' style='text-align:center'>Nenhum registro encontrado para estes filtros.</td></tr>";
        }

    } catch (e) {
        console.error(e);
        tbody.innerHTML = "<tr><td colspan='6' style='color:red'>Erro ao carregar histórico.</td></tr>";
    }
}

// --- AÇÕES ---
window.excluirRegistro = async (id) => {
    if (confirm("Deseja remover permanentemente este registro do histórico?")) {
        await deleteDoc(doc(db, "movimentacoes", id));
        listarHistorico();
    }
};

// Eventos de Filtro
document.getElementById("filtroData").addEventListener("change", listarHistorico);
document.getElementById("filtroTipo").addEventListener("change", listarHistorico);
document.getElementById("btnLimpar").onclick = () => {
    document.getElementById("filtroData").value = "";
    document.getElementById("filtroTipo").value = "Todos";
    listarHistorico();
};
