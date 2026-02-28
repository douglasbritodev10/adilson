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
        
        let username = user.email.split('@')[0].toUpperCase();
        if (userSnap.exists()) {
            const data = userSnap.data();
            userRole = (data.role || "leitor").toLowerCase();
            username = data.nomeCompleto || username;
        }

        document.getElementById("userDisplay").innerHTML = `<i class="fas fa-user-circle"></i> ${username} (${userRole.toUpperCase()})`;
        
        // Regra Admin: Criar endereços
        document.getElementById("areaAdmin").style.display = (userRole === 'admin') ? 'block' : 'none';
        
        loadAll();
    } else { window.location.href = "index.html"; }
});

// --- 2. CARREGAMENTO DE DADOS ---
async function loadAll() {
    try {
        const fSnap = await getDocs(collection(db, "fornecedores"));
        fSnap.forEach(d => dbState.fornecedores[d.id] = d.data().nome);

        const pSnap = await getDocs(collection(db, "produtos"));
        pSnap.forEach(d => {
            const p = d.data();
            dbState.produtos[d.id] = { 
                nome: p.nome, 
                codigo: p.codigo || "S/C", 
                forn: dbState.fornecedores[p.fornecedorId] || "---" 
            };
        });
        syncUI();
    } catch (e) { console.error(e); }
}

async function syncUI() {
    const eSnap = await getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo")));
    dbState.enderecos = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    const vSnap = await getDocs(collection(db, "volumes"));
    dbState.volumes = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    renderPendentes();
    renderEnderecos();
}

// --- 3. LÓGICA DE SOMA INTELIGENTE (O CORAÇÃO DO AJUSTE) ---
window.abrirMover = (volId) => {
    if (userRole === "leitor") return alert("Acesso negado: Apenas Operadores ou Admins podem movimentar.");
    
    const vol = dbState.volumes.find(v => v.id === volId);
    if (!vol) return;

    const modal = document.getElementById("modalMaster");
    document.getElementById("modalBody").innerHTML = `
        <input type="hidden" id="modalVolId" value="${vol.id}">
        <p><b>Volume:</b> ${vol.descricao} (${vol.quantidade} un)</p>
        <label>Destino:</label>
        <select id="selDestino">
            <option value="">Selecione o endereço...</option>
            ${dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo}</option>`).join('')}
        </select>
        <label>Quantidade:</label>
        <input type="number" id="qtdMover" value="${vol.quantidade}" min="1" max="${vol.quantidade}">
    `;
    modal.style.display = "flex";

    document.getElementById("btnConfirmar").onclick = async () => {
        const destId = document.getElementById("selDestino").value;
        const qtd = parseInt(document.getElementById("qtdMover").value);

        if (!destId || isNaN(qtd) || qtd <= 0 || qtd > vol.quantidade) return alert("Dados inválidos!");

        try {
            // BUSCA SE JÁ EXISTE O MESMO PRODUTO + VOLUME NO DESTINO
            const itemExistente = dbState.volumes.find(v => 
                v.enderecoId === destId && 
                v.produtoId === vol.produtoId && 
                v.descricao === vol.descricao
            );

            if (itemExistente) {
                // SOMA 25+25 NO DESTINO
                await updateDoc(doc(db, "volumes", itemExistente.id), { 
                    quantidade: increment(qtd),
                    ultimaMov: serverTimestamp() 
                });
            } else {
                // CRIA NOVO SE NÃO EXISTIR LÁ
                await addDoc(collection(db, "volumes"), {
                    produtoId: vol.produtoId,
                    descricao: vol.descricao,
                    codigoVol: vol.codigoVol || "",
                    quantidade: qtd,
                    enderecoId: destId,
                    dataMov: serverTimestamp()
                });
            }

            // ATUALIZA ORIGEM (Subtrai ou remove)
            const novaQtdOrigem = vol.quantidade - qtd;
            await updateDoc(doc(db, "volumes", vol.id), {
                quantidade: novaQtdOrigem,
                enderecoId: novaQtdOrigem === 0 ? "" : vol.enderecoId
            });

            window.fecharModal();
            syncUI();
        } catch (e) { alert("Erro ao salvar!"); }
    };
};

// --- 4. RENDERIZAÇÃO E FILTROS ---
function renderEnderecos() {
    const grid = document.getElementById("gridEnderecos");
    grid.innerHTML = "";
    let count = 0;

    dbState.enderecos.forEach(end => {
        const vols = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        const card = document.createElement('div');
        card.className = "card-endereco";
        
        // Texto invisível para busca rápida
        let metaBusca = `RUA ${end.rua} MOD ${end.modulo} `;
        
        let htmlVols = vols.map(v => {
            const p = dbState.produtos[v.produtoId] || {nome:"Excluído", forn:"--", codigo:"--"};
            metaBusca += `${p.nome} ${p.forn} ${p.codigo} ${v.descricao} `;
            
            return `
            <div class="vol-item">
                <div class="vol-info">
                    <small>${p.forn}</small><br>
                    <b>${p.nome}</b> [${p.codigo}]<br>
                    <small>${v.descricao} | Qtd: <b>${v.quantidade}</b></small>
                </div>
                ${(userRole !== 'leitor') ? `
                    <div style="display:flex; gap:5px;">
                        <button onclick="window.abrirMover('${v.id}')" class="btn-action" style="background:var(--primary)"><i class="fas fa-exchange-alt"></i></button>
                        <button onclick="window.darSaida('${v.id}', ${v.quantidade})" class="btn-action" style="background:var(--danger)"><i class="fas fa-minus"></i></button>
                    </div>
                ` : ''}
            </div>`;
        }).join('');

        card.dataset.busca = metaBusca.toLowerCase();
        card.innerHTML = `
            <div class="card-header">
                <span>RUA ${end.rua} - MOD ${end.modulo}</span>
                ${(userRole === 'admin') ? `<i class="fas fa-trash" onclick="window.deletarLocal('${end.id}')" style="cursor:pointer; opacity:0.5"></i>` : ''}
            </div>
            ${htmlVols || '<p style="padding:10px; color:#999; font-size:12px;">Vazio</p>'}
        `;
        grid.appendChild(card);
        count++;
    });
    document.getElementById("countDisplay").innerText = count;
}

function renderPendentes() {
    const area = document.getElementById("pendentesArea");
    area.innerHTML = "";
    dbState.volumes.filter(v => v.quantidade > 0 && !v.enderecoId).forEach(v => {
        const p = dbState.produtos[v.produtoId] || {nome:"---"};
        area.innerHTML += `
            <div class="vol-item" style="background:white; margin-bottom:5px; border-radius:6px; flex-direction:column; align-items:flex-start;">
                <div style="font-size:12px;"><b>${p.nome}</b></div>
                <div style="font-size:11px; color:#666;">${v.descricao} (Qtd: ${v.quantidade})</div>
                ${(userRole !== 'leitor') ? `<button onclick="window.abrirMover('${v.id}')" style="width:100%; margin-top:5px; cursor:pointer; background:var(--warning); border:none; border-radius:4px; font-weight:bold;">ENDEREÇAR</button>` : ''}
            </div>`;
    });
}

// --- 5. FUNÇÕES AUXILIARES ---
window.filtrarEstoque = () => {
    const termo = document.getElementById("filtroGeral").value.toLowerCase();
    document.querySelectorAll(".card-endereco").forEach(card => {
        card.style.display = card.dataset.busca.includes(termo) ? "flex" : "none";
    });
};

window.criarEndereco = async () => {
    const rua = document.getElementById("addRua").value.toUpperCase();
    const mod = document.getElementById("addModulo").value;
    if(!rua || !mod) return alert("Preencha Rua e Módulo!");
    await addDoc(collection(db, "enderecos"), { rua, modulo: mod, data: serverTimestamp() });
    syncUI();
};

window.darSaida = async (id, max) => {
    const q = prompt("Quantidade para saída:", max);
    if(q && parseInt(q) > 0 && parseInt(q) <= max) {
        await updateDoc(doc(db, "volumes", id), { quantidade: increment(-parseInt(q)) });
        syncUI();
    }
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
