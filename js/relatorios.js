import { db, auth } from "./firebase-config.js";
import { collection, getDocs, query, orderBy, where } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

async function carregarRelatorio() {
    const tbody = document.getElementById("corpoRelatorio");
    tbody.innerHTML = "<tr><td colspan='6' style='text-align:center'>Carregando movimentações...</td></tr>";

    try {
        const q = query(collection(db, "movimentacoes"), orderBy("data", "desc"));
        const snap = await getDocs(q);
        
        const fInicio = document.getElementById("dataInicio").value; // YYYY-MM-DD
        const fFim = document.getElementById("dataFim").value;
        const fTipo = document.getElementById("filtroTipo").value;

        tbody.innerHTML = "";

        snap.forEach(doc => {
            const m = doc.data();
            const dataObjeto = m.data?.toDate() || new Date();
            const dataFormatada = dataObjeto.toLocaleString('pt-BR');
            const dataISO = dataObjeto.toISOString().split('T')[0];

            // Lógica de Filtro em Tempo Real (Cliente)
            if (fInicio && dataISO < fInicio) return;
            if (fFim && dataISO > fFim) return;
            if (fTipo && m.tipo !== fTipo) return;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${dataFormatada}</td>
                <td><strong>${m.produto}</strong></td>
                <td><span class="badge ${m.tipo === 'Saída' ? 'bg-saida' : 'bg-entrada'}">${m.tipo.toUpperCase()}</span></td>
                <td>${m.quantidade}</td>
                <td style="color:#666; font-size:12px;">${m.detalhe || '-'}</td>
                <td>${m.usuario ? m.usuario.split('@')[0] : 'Sistema'}</td>
            `;
            tbody.appendChild(tr);
        });

        if (tbody.innerHTML === "") {
            tbody.innerHTML = "<tr><td colspan='6' style='text-align:center'>Nenhuma movimentação encontrada para este período.</td></tr>";
        }

    } catch (e) {
        console.error("Erro ao carregar relatório:", e);
        tbody.innerHTML = "<tr><td colspan='6' style='text-align:center; color:red'>Erro ao carregar dados. Verifique o console.</td></tr>";
    }
}

// Iniciar ao carregar a página
window.carregarRelatorio = carregarRelatorio;
carregarRelatorio();
