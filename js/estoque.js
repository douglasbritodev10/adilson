import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let usernameDB = "Usuário";
let userRole = "leitor";

// --- 1. CONTROLE DE ACESSO ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const data = userSnap.data();
            usernameDB = data.nomeCompleto || "Usuário";
            userRole = (data.role || "leitor").toLowerCase();
            
            // Exibe barra de cadastro apenas para Admins
            const areaCad = document.querySelector(".cadastro-bar");
            if(areaCad) areaCad.style.display = (userRole === 'admin') ? 'flex' : 'none';
        }
        const display = document.getElementById("userDisplay");
        if(display) display.innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB} (${userRole.toUpperCase()})`;
        loadAll();
    } else { 
        window.location.href = "index.html"; 
    }
});

// --- 2. CARREGAMENTO DE DADOS ---
async function loadAll() {
    try {
        const fSnap = await getDocs(collection(db, "fornecedores"));
        dbState.fornecedores = {};
        fSnap.forEach(d => dbState.fornecedores[d.id] = d.data().nome);

        const pSnap = await getDocs(collection(db, "produtos"));
        dbState.produtos = {};
        pSnap.forEach(d => {
            const p = d.data();
            dbState.produtos[d.id] = { 
                nome: p.nome, 
                codigo: p.codigo || "S/C",
                forn: dbState.fornecedores[p.fornecedorId] || "---" 
            };
        });

        await syncUI();
    } catch (e) { console.error("Erro no loadAll:", e); }
}

async function syncUI() {
    const eSnap = await getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo")));
    dbState.enderecos = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    const vSnap = await getDocs(collection(db, "volumes"));
    dbState.volumes = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    renderPendentes();
    renderEnderecos();
    if(window.filtrarEstoque) window.filtrarEstoque();
}

// --- 3. LOGICA DE MOVIMENTAÇÃO (SOMA 25+25 E CORREÇÃO DE ERROS) ---
window.confirmarMovimentacao = async () => {
    if (userRole === "leitor") return alert("Acesso negado.");

    const volId = document.getElementById("modalVolId")?.value;
    const destId = document.getElementById("selDestino")?.value;
    const qtdMover = parseInt(document.getElementById("qtdMover")?.value);

    // Validação para evitar o erro de 'indexOf' (null) no Firebase
    if (!volId || !destId || isNaN(qtdMover) || qtdMover <= 0) {
        return alert("Por favor, selecione o destino e a quantidade corretamente.");
    }

    const volOrigem = dbState.volumes.find(v => v.id === volId);
    if (!volOrigem || qtdMover > volOrigem.quantidade) {
        return alert("Erro: Volume não encontrado ou quantidade insuficiente.");
    }

    try {
        // LÓGICA DE SOMA: Procura se o mesmo produto/volume já existe no endereço de destino
        const itemExistenteNoDestino = dbState.volumes.find(v => 
            v.enderecoId === destId && 
            v.produtoId === volOrigem.produtoId && 
            v.descricao === volOrigem.descricao
        );

        if (itemExistenteNoDestino) {
            // Se já existe, apenas incrementa a quantidade no documento que já está lá
            await updateDoc(doc(db, "volumes", itemExistenteNoDestino.id), {
                quantidade: increment(qtdMover),
                ultimaMov: serverTimestamp()
            });
        } else {
            // Se não existe, cria um novo registro vinculado ao endereço
            await addDoc(collection(db, "volumes"), {
                produtoId: volOrigem.produtoId,
                descricao: volOrigem.descricao,
                codigoVol: volOrigem.codigoVol || "",
                quantidade: qtdMover,
                enderecoId: destId,
                dataMov: serverTimestamp()
            });
        }

        // Atualiza a origem: subtrai o que foi movido
        const novaQtdOrigem = volOrigem.quantidade - qtdMover;
        await updateDoc(doc(db, "volumes", volId), {
            quantidade: novaQtdOrigem,
            // Se zerar, desvincula o endereço para o card sumir daquele local
            enderecoId: novaQtdOrigem === 0 ? "" : volOrigem.enderecoId
        });

        window.fecharModal();
        syncUI();
    } catch (e) {
        console.error("Erro na movimentação:", e);
        alert("Erro técnico ao processar a movimentação.");
    }
};

// --- 4. CADASTRO DE ENDEREÇO COM TRAVA DE DUPLICIDADE ---
window.criarEndereco = async () => {
    if (userRole !== "admin") return alert("Somente administradores podem criar endereços.");

    const rua = document.getElementById("addRua")?.value.trim().toUpperCase();
    const mod = document.getElementById("addModulo")?.value.trim();

    if (!rua || !mod) return alert("Preencha Rua e Módulo!");

    // TRAVA: Verifica no dbState se já existe Rua + Módulo igual
    const enderecoDuplicado = dbState.enderecos.find(e => e.rua === rua && e.modulo === mod);
    if (enderecoDuplicado) {
        return alert(`O endereço RUA ${rua} - MOD ${mod} já existe!`);
    }

    try {
        await addDoc(collection(db, "enderecos"), {
            rua, modulo: mod, dataCriacao: serverTimestamp()
        });
        document.getElementById("addRua").value = "";
        document.getElementById("addModulo").value = "";
        syncUI();
    } catch (e) {
        alert("Erro ao salvar endereço.");
    }
};

// --- 5. FUNÇÃO PARA ABRIR MODAL (CORREÇÃO DE 'undefined') ---
window.abrirModalMover = (volId) => {
    if (userRole === "leitor") return alert("Seu nível de acesso não permite movimentações.");

    const vol = dbState.volumes.find(v => v.id === volId);
    
    // Proteção contra o erro 'Cannot read properties of undefined (reading produtoId)'
    if (!vol) {
        console.error("Volume não encontrado para o ID:", volId);
        return alert("Erro ao carregar dados do volume.");
    }

    const prod = dbState.produtos[vol.produtoId] || { nome: "Desconhecido" };

    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = "Endereçar / Mover";
    document.getElementById("modalBody").innerHTML = `
        <input type="hidden" id="modalVolId" value="${vol.id}">
        <p><strong>Produto:</strong> ${prod.nome}</p>
        <p><strong>Volume:</strong> ${vol.descricao} (Saldo: ${vol.quantidade})</p>
        
        <label>Destino:</label>
        <select id="selDestino" class="form-control">
            <option value="">-- Selecione o Local --</option>
            ${dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo}</option>`).join('')}
        </select>
        
        <label>Qtd para Mover:</label>
        <input type="number" id="qtdMover" value="${vol.quantidade}" min="1" max="${vol.quantidade}" class="form-control">
    `;
    modal.style.display = "flex";
};

// --- 6. RENDERIZAÇÃO E FILTROS (MANTENDO O LAYOUT) ---
function renderEnderecos() {
    const grid = document.getElementById("gridEnderecos");
    if(!grid) return;
    grid.innerHTML = "";

    dbState.enderecos.forEach(end => {
        const volsNoLocal = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        const card = document.createElement('div');
        card.className = "card-endereco";
        
        let tagsBusca = `rua ${end.rua} mod ${end.modulo} `;
        
        let htmlVols = volsNoLocal.map(v => {
            const p = dbState.produtos[v.produtoId] || { nome: "---", forn: "---" };
            tagsBusca += `${p.nome} ${v.descricao} ${p.forn} `.toLowerCase();
            
            return `
            <div class="vol-item">
                <div style="flex:1">
                    <small style="color:var(--primary)">${p.forn}</small><br>
                    <strong>${p.nome}</strong><br>
                    <small>${v.descricao} | Qtd: <b>${v.quantidade}</b></small>
                </div>
                ${userRole !== 'leitor' ? `
                <div class="actions">
                    <button onclick="window.abrirModalMover('${v.id}')"><i class="fas fa-exchange-alt"></i></button>
                    <button onclick="window.darSaida('${v.id}', ${v.quantidade})" style="color:var(--danger)"><i class="fas fa-sign-out-alt"></i></button>
                </div>` : ''}
            </div>`;
        }).join('');

        card.dataset.busca = tagsBusca;
        card.innerHTML = `
            <div class="card-header">
                <span>RUA ${end.rua} - MOD ${end.modulo}</span>
                ${userRole === 'admin' ? `<i class="fas fa-trash" onclick="window.deletarLocal('${end.id}')" style="cursor:pointer; font-size:12px; opacity:0.3"></i>` : ""}
            </div>
            ${htmlVols || '<div style="padding:15px; color:#999; text-align:center; font-size:12px">Vazio</div>'}
        `;
        grid.appendChild(card);
    });
}

function renderPendentes() {
    const container = document.getElementById("pendentesArea");
    if(!container) return;
    container.innerHTML = "";
    
    dbState.volumes.filter(v => v.quantidade > 0 && !v.enderecoId).forEach(v => {
        const p = dbState.produtos[v.produtoId] || { nome: "---" };
        const div = document.createElement("div");
        div.className = "vol-item-pendente";
        div.innerHTML = `
            <div style="font-size:12px"><strong>${p.nome}</strong></div>
            <div style="font-size:11px; color:#666">${v.descricao} (Qtd: ${v.quantidade})</div>
            ${userRole !== 'leitor' ? `<button onclick="window.abrirModalMover('${v.id}')" class="btn-pendente">ENDEREÇAR</button>` : ''}
        `;
        container.appendChild(div);
    });
}

// Auxiliares
window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
window.darSaida = async (id, max) => {
    const q = prompt("Quantidade para saída:", max);
    if(q && parseInt(q) > 0 && parseInt(q) <= max) {
        await updateDoc(doc(db, "volumes", id), { quantidade: increment(-parseInt(q)) });
        loadAll();
    }
};
window.deletarLocal = async (id) => {
    if(confirm("Deseja excluir este endereço?")) {
        await deleteDoc(doc(db, "enderecos", id));
        loadAll();
    }
};
