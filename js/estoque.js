import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let userRole = "leitor";

// --- 1. CONTROLE DE ACESSO ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            userRole = (userSnap.data().role || "leitor").toLowerCase();
            const btnEnd = document.getElementById("btnNovoEnd");
            if(btnEnd) btnEnd.style.display = (userRole === 'admin') ? 'block' : 'none';
        }
        loadAll();
    } else { window.location.href = "index.html"; }
});

// --- 2. CARGA DE DADOS ---
async function loadAll() {
    const fSnap = await getDocs(collection(db, "fornecedores"));
    dbState.fornecedores = {};
    fSnap.forEach(d => dbState.fornecedores[d.id] = d.data().nome);

    const pSnap = await getDocs(collection(db, "produtos"));
    dbState.produtos = {};
    pSnap.forEach(d => {
        const p = d.data();
        dbState.produtos[d.id] = { nome: p.nome, codigo: p.codigo || "S/C", forn: dbState.fornecedores[p.fornecedorId] || "---" };
    });
    syncUI();
}

async function syncUI() {
    const eSnap = await getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo")));
    dbState.enderecos = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const vSnap = await getDocs(collection(db, "volumes"));
    dbState.volumes = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEnderecos();
    renderPendentes();
}

// --- 3. ABRIR MODAL (LIMPO E SEM BOTÕES DUPLICADOS) ---
window.abrirModalMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    if (!vol) return alert("Volume não encontrado!");

    const prod = dbState.produtos[vol.produtoId] || { nome: "Produto" };
    const modal = document.getElementById("modalMaster");
    const modalBody = document.getElementById("modalBody");
    
    // Inserimos o conteúdo e APENAS UM botão de ação no modalBody
    modalBody.innerHTML = `
        <input type="hidden" id="modalVolId" value="${vol.id}">
        <div style="margin-bottom:15px; font-size:14px; background:#eee; padding:10px; border-radius:5px;">
            <strong>${prod.nome}</strong><br>Volume: ${vol.descricao} | Saldo: ${vol.quantidade}
        </div>
        <label>Para onde deseja mover?</label>
        <select id="selDestino" style="width:100%; padding:10px; margin:10px 0;">
            <option value="">-- Selecione o Endereço --</option>
            ${dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo}</option>`).join('')}
        </select>
        <label>Quantidade:</label>
        <input type="number" id="qtdMover" value="${vol.quantidade}" max="${vol.quantidade}" min="1" style="width:100%; padding:10px;">
        
        <button onclick="window.confirmarMovimentacao()" class="btn" style="width:100%; margin-top:20px; background:var(--success); color:white; font-weight:bold; height:45px;">
            CONFIRMAR MOVIMENTAÇÃO
        </button>
    `;

    // Removemos qualquer botão de confirmar que esteja "sobrando" no rodapé do HTML original
    const btnRodapeOriginal = document.querySelector("#modalMaster .modal-content > div > button[onclick*='confirmar']");
    if(btnRodapeOriginal) btnRodapeOriginal.style.display = 'none';

    modal.style.display = "flex";
};

// --- 4. LOGICA 25+25 (SOMA INTELIGENTE) ---
window.confirmarMovimentacao = async () => {
    const volId = document.getElementById("modalVolId")?.value;
    const destId = document.getElementById("selDestino")?.value;
    const qtd = parseInt(document.getElementById("qtdMover")?.value);

    if (!destId) return alert("Selecione um endereço de destino!");
    if (isNaN(qtd) || qtd <= 0) return alert("Quantidade inválida!");

    const volOrigem = dbState.volumes.find(v => v.id === volId);
    
    try {
        // VERIFICA SE JÁ EXISTE NO DESTINO (SOMA)
        const existeNoDestino = dbState.volumes.find(v => 
            v.enderecoId === destId && 
            v.produtoId === volOrigem.produtoId && 
            v.descricao === volOrigem.descricao
        );

        if (existeNoDestino) {
            await updateDoc(doc(db, "volumes", existeNoDestino.id), {
                quantidade: increment(qtd),
                ultimaAtu: serverTimestamp()
            });
        } else {
            await addDoc(collection(db, "volumes"), {
                produtoId: volOrigem.produtoId,
                descricao: volOrigem.descricao,
                quantidade: qtd,
                enderecoId: destId,
                data: serverTimestamp()
            });
        }

        // SUBTRAI DA ORIGEM
        const novaQtd = volOrigem.quantidade - qtd;
        await updateDoc(doc(db, "volumes", volId), {
            quantidade: novaQtd,
            enderecoId: novaQtd === 0 ? "" : volOrigem.enderecoId
        });

        window.fecharModal();
        syncUI();
    } catch (e) {
        console.error("Erro na linha 136/103:", e);
        alert("Erro ao processar movimentação.");
    }
};

// --- 5. CADASTRO DE ENDEREÇO COM TRAVA ---
window.salvarNovoEndereco = async () => {
    const rua = document.getElementById("addRua").value.trim().toUpperCase();
    const mod = document.getElementById("addModulo").value.trim();

    const duplicado = dbState.enderecos.find(e => e.rua === rua && e.modulo === mod);
    if (duplicado) return alert("Este endereço já existe!");

    await addDoc(collection(db, "enderecos"), { rua, modulo: mod });
    window.fecharModal();
    syncUI();
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
