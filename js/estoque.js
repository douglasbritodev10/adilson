import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let state = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let userRole = "leitor";
let userName = "";

// --- INICIALIZAÇÃO E SEGURANÇA ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
            const data = userSnap.data();
            userRole = (data.role || "leitor").toLowerCase();
            userName = data.nomeCompleto || user.email.split('@')[0].toUpperCase();
            document.getElementById("userDisplay").innerHTML = `<i class="fas fa-user-circle"></i> <span>${userName}</span>`;
        }
        carregarDados();
    } else { window.location.href = "index.html"; }
});

document.getElementById("btnLogout").onclick = () => signOut(auth);

// --- CARGA DE DADOS (FORNECEDORES, PRODUTOS, ENDEREÇOS, VOLUMES) ---
async function carregarDados() {
    try {
        const [fSnap, pSnap, eSnap, vSnap] = await Promise.all([
            getDocs(collection(db, "fornecedores")),
            getDocs(collection(db, "produtos")),
            getDocs(query(collection(db, "enderecos"), orderBy("nome"))),
            getDocs(collection(db, "volumes"))
        ]);

        // Mapeia Fornecedores
        state.fornecedores = {};
        const selectForn = document.getElementById("filtroForn");
        selectForn.innerHTML = '<option value="">Todos Fornecedores</option>';
        fSnap.forEach(d => {
            state.fornecedores[d.id] = d.data().nome;
            selectForn.innerHTML += `<option value="${d.id}">${d.data().nome}</option>`;
        });

        // Mapeia Produtos
        state.produtos = {};
        pSnap.forEach(d => { state.produtos[d.id] = d.data(); });

        state.enderecos = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        state.volumes = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        renderizarTudo();
    } catch (err) { console.error("Erro ao carregar:", err); }
}

// --- RENDERIZAÇÃO ---
window.filtrar = () => renderizarTudo();

function renderizarTudo() {
    const fCod = document.getElementById("filtroCod").value.toUpperCase();
    const fForn = document.getElementById("filtroForn").value;
    const fDesc = document.getElementById("filtroDesc").value.toUpperCase();

    const containerPendentes = document.getElementById("listaPendentes");
    const containerEnderecos = document.getElementById("gridEnderecos");
    
    containerPendentes.innerHTML = "";
    containerEnderecos.innerHTML = "";

    // 1. Volumes Pendentes (Sem endereçoId)
    const pendentes = state.volumes.filter(v => !v.enderecoId);
    if(pendentes.length === 0) {
        document.getElementById("painelPendentes").style.display = "none";
    } else {
        document.getElementById("painelPendentes").style.display = "block";
        pendentes.forEach(v => {
            containerPendentes.innerHTML += `
                <div class="vol-item" style="min-width: 200px; border-top: 3px solid var(--warning);">
                    <strong>${v.codigo}</strong><br><small>${v.descricao}</small><br>
                    <button class="btn-sm" style="background:var(--primary); width:100%; margin-top:5px;" onclick="window.abrirMover('${v.id}')">ENDEREÇAR</button>
                </div>`;
        });
    }

    // 2. Grid de Endereços
    state.enderecos.forEach(end => {
        const volsNesteEnd = state.volumes.filter(v => v.enderecoId === end.id);
        
        // Aplica filtros
        const volsFiltrados = volsNesteEnd.filter(v => {
            const prod = state.produtos[v.produtoId] || {};
            const matchCod = !fCod || (v.codigo?.toUpperCase().includes(fCod));
            const matchForn = !fForn || prod.fornecedorId === fForn;
            const matchDesc = !fDesc || (v.descricao?.toUpperCase().includes(fDesc));
            return matchCod && matchForn && matchDesc;
        });

        if (volsFiltrados.length > 0 || (!fCod && !fForn && !fDesc)) {
            let htmlVols = volsFiltrados.map(v => `
                <div class="vol-item">
                    <b>${v.codigo}</b> - Qtd: ${v.quantidade}<br>
                    <small>${v.descricao}</small>
                    <div class="vol-actions">
                        <button class="btn-sm" style="background:var(--warning)" onclick="window.abrirMover('${v.id}')"><i class="fas fa-exchange-alt"></i></button>
                        <button class="btn-sm" style="background:var(--danger)" onclick="window.darSaida('${v.id}')"><i class="fas fa-minus"></i></button>
                    </div>
                </div>
            `).join('');

            containerEnderecos.innerHTML += `
                <div class="endereco-card">
                    <div class="end-header"><span>${end.nome}</span> <i class="fas fa-map-marker-alt" style="color:var(--primary)"></i></div>
                    ${htmlVols || '<small style="color:gray">Endereço Vazio</small>'}
                </div>`;
        }
    });
}

// --- FUNÇÕES DE MOVIMENTAÇÃO ---
window.abrirMover = (volId) => {
    const vol = state.volumes.find(v => v.id === volId);
    if (!vol) return;

    const selectDest = document.getElementById("selDestino");
    selectDest.innerHTML = state.enderecos.map(e => `<option value="${e.id}">${e.nome}</option>`).join('');
    
    document.getElementById("qtdMover").value = vol.quantidade;
    document.getElementById("modalMaster").style.display = "flex";

    document.getElementById("btnConfirmarAcao").onclick = async () => {
        const destId = selectDest.value;
        const qtd = parseInt(document.getElementById("qtdMover").value);
        
        if (qtd <= 0 || qtd > vol.quantidade) return alert("Quantidade inválida!");

        try {
            // Se mover tudo, atualiza o endereço do volume existente
            if (qtd === vol.quantidade) {
                await updateDoc(doc(db, "volumes", volId), { enderecoId: destId });
            } else {
                // Se mover parte, subtrai do atual e cria um novo no destino
                await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtd) });
                await addDoc(collection(db, "volumes"), { ...vol, id: null, quantidade: qtd, enderecoId: destId });
            }

            await registrarHistorico("Movimentação", vol.descricao, qtd, `Para: ${state.enderecos.find(e => e.id === destId).nome}`);
            window.fecharModal();
            carregarDados();
        } catch (e) { alert("Erro ao mover"); }
    };
};

window.darSaida = async (volId) => {
    const vol = state.volumes.find(v => v.id === volId);
    const qtd = prompt(`Quantidade para SAÍDA (Máx: ${vol.quantidade}):`, vol.quantidade);
    const qtdNum = parseInt(qtd);

    if (qtdNum > 0 && qtdNum <= vol.quantidade) {
        if (qtdNum === vol.quantidade) await deleteDoc(doc(db, "volumes", volId));
        else await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtdNum) });

        await registrarHistorico("Saída", vol.descricao, qtdNum, "Saída direta do estoque");
        carregarDados();
    }
};

async function registrarHistorico(tipo, produto, qtd, obs) {
    await addDoc(collection(db, "movimentacoes"), {
        tipo, produto, quantidade: qtd, observacao: obs,
        usuario: userName, data: serverTimestamp()
    });
}

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
