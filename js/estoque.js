import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let usernameDB = "Usuário";
let userRole = "leitor";

// --- CONTROLE DE ACESSO ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const data = userSnap.data();
            usernameDB = data.nomeCompleto || "Usuário";
            userRole = (data.role || "leitor").toLowerCase();
            
            // Exibe botão de novo endereço apenas para Admins
            const btnEnd = document.getElementById("btnNovoEnd");
            if(btnEnd) btnEnd.style.display = (userRole === 'admin') ? 'block' : 'none';
        }
        // Corrigido para bater com o ID do seu HTML
        const display = document.getElementById("userDisplay"); 
        if(display) display.innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB} (${userRole.toUpperCase()})`;
        
        loadAll();
    } else { 
        window.location.href = "index.html"; 
    }
});

async function loadAll() {
    try {
        const [fS, pS] = await Promise.all([
            getDocs(collection(db, "fornecedores")),
            getDocs(collection(db, "produtos"))
        ]);

        dbState.fornecedores = {};
        fS.forEach(d => dbState.fornecedores[d.id] = d.data().nome);

        dbState.produtos = {};
        pS.forEach(d => {
            const p = d.data();
            dbState.produtos[d.id] = { 
                nome: p.nome, 
                forn: dbState.fornecedores[p.fornecedorId] || "---" 
            };
        });

        await syncUI();
    } catch (e) { console.error("Erro ao carregar:", e); }
}

async function syncUI() {
    const [eS, vS] = await Promise.all([
        getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo"))),
        getDocs(collection(db, "volumes"))
    ]);

    dbState.enderecos = eS.docs.map(d => ({ id: d.id, ...d.data() }));
    dbState.volumes = vS.docs.map(d => ({ id: d.id, ...d.data() }));

    renderPendentes();
    renderEnderecos();
}

// --- PENDENTES (Lógica de "Falta Endereçar") ---
function renderPendentes() {
    const area = document.getElementById("pendentesArea"); // ID corrigido para bater com seu HTML
    const count = document.getElementById("countPendentes");
    if(!area) return;

    const pendentes = dbState.volumes.filter(v => v.quantidade > 0 && (!v.enderecoId || v.enderecoId === ""));
    
    if(count) count.innerText = pendentes.length;
    
    area.innerHTML = pendentes.map(v => {
        const p = dbState.produtos[v.produtoId] || {nome:"Produto não encontrado"};
        return `
            <div class="vol-item-pendente" style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; margin-bottom:10px; border-left:4px solid var(--warning);">
                <div style="flex:1">
                    <strong style="color:white;">${p.nome}</strong><br>
                    <small style="color:#aaa;">${v.descricao} | Qtd: ${v.quantidade}</small>
                </div>
                ${userRole !== 'leitor' ? 
                    `<button onclick="window.abrirModalMover('${v.id}')" style="background:var(--warning); border:none; padding:5px 10px; border-radius:4px; cursor:pointer; font-weight:bold;">ENDEREÇAR</button>` : ''}
            </div>
        `;
    }).join('');
}

function renderEnderecos() {
    const grid = document.getElementById("gridEnderecos");
    if(!grid) return;
    grid.innerHTML = "";

    dbState.enderecos.forEach(end => {
        const vols = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        const card = document.createElement('div');
        card.className = "card-endereco";
        
        let buscaTxt = `rua ${end.rua} mod ${end.modulo} `.toLowerCase();
        
        let htmlVols = vols.map(v => {
            const p = dbState.produtos[v.produtoId] || {nome:"---", forn:"---"};
            buscaTxt += `${p.nome} ${p.forn} ${v.descricao} `.toLowerCase();
            return `
                <div class="vol-item">
                    <div style="flex:1">
                        <small><b>${p.forn}</b></small><br>
                        <strong>${p.nome}</strong><br>
                        <small>${v.descricao} | Qtd: ${v.quantidade}</small>
                    </div>
                    ${userRole !== 'leitor' ? `
                        <div class="actions">
                            <button onclick="window.abrirModalMover('${v.id}')"><i class="fas fa-exchange-alt"></i></button>
                            <button onclick="window.darSaida('${v.id}', '${v.descricao}', ${v.quantidade})" style="color:var(--danger)"><i class="fas fa-sign-out-alt"></i></button>
                        </div>
                    ` : ''}
                </div>`;
        }).join('');

        card.dataset.busca = buscaTxt;
        card.innerHTML = `
            <div class="card-header">
                RUA ${end.rua} - MOD ${end.modulo}
                ${userRole === 'admin' ? `<i class="fas fa-trash" onclick="window.deletarLocal('${end.id}')" style="float:right; cursor:pointer; font-size:12px;"></i>` : ''}
            </div>
            ${htmlVols || '<div style="text-align:center; padding:10px; color:#999;">Vazio</div>'}
        `;
        grid.appendChild(card);
    });
    window.filtrarEstoque();
}

// --- FUNÇÕES GLOBAIS ---
window.abrirModalMover = (volId) => {
    if(userRole === 'leitor') return;
    const vol = dbState.volumes.find(v => v.id === volId);
    const p = dbState.produtos[vol.produtoId];
    
    document.getElementById("modalTitle").innerText = "Movimentar / Endereçar";
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("modalBody").innerHTML = `
        <input type="hidden" id="modalVolId" value="${volId}">
        <p style="color:white"><strong>Item:</strong> ${p.nome} (${vol.descricao})</p>
        <label style="color:white">Quantidade (Disponível: ${vol.quantidade}):</label>
        <input type="number" id="qtdMover" value="${vol.quantidade}" min="1" max="${vol.quantidade}" style="width:100%; margin:10px 0;">
        <label style="color:white">Destino:</label>
        <select id="selDestino" style="width:100%; padding:8px;">
            <option value="">-- Selecione o Endereço --</option>
            ${dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo}</option>`).join('')}
        </select>
    `;
    // Configura o botão de salvar do seu modal
    const btnSalvar = document.querySelector("#modalMaster .btn:not([onclick*='fechar'])");
    btnSalvar.onclick = window.confirmarMovimentacao;
};

window.confirmarMovimentacao = async () => {
    const volId = document.getElementById("modalVolId").value;
    const destId = document.getElementById("selDestino").value;
    const qtdMover = parseInt(document.getElementById("qtdMover").value);

    if (!destId || isNaN(qtdMover) || qtdMover <= 0) return alert("Preencha todos os campos!");

    const volOrigem = dbState.volumes.find(v => v.id === volId);

    try {
        // Lógica de Junção Profissional
        const destinoExistente = dbState.volumes.find(v => 
            v.enderecoId === destId && 
            v.produtoId === volOrigem.produtoId && 
            v.descricao === volOrigem.descricao
        );

        if (destinoExistente) {
            await updateDoc(doc(db, "volumes", destinoExistente.id), { quantidade: increment(qtdMover) });
        } else {
            await addDoc(collection(db, "volumes"), {
                ...volOrigem,
                id: null,
                quantidade: qtdMover,
                enderecoId: destId,
                dataMov: serverTimestamp()
            });
        }

        const sobra = volOrigem.quantidade - qtdMover;
        await updateDoc(doc(db, "volumes", volId), { 
            quantidade: sobra,
            enderecoId: sobra <= 0 && volOrigem.enderecoId === "" ? "REMOVIDO" : volOrigem.enderecoId 
        });

        window.fecharModal();
        loadAll();
    } catch (e) { console.error(e); }
};

window.darSaida = async (id, desc, qtdAtual) => {
    if(userRole === 'leitor') return;
    const q = prompt(`Saída de: ${desc}\nQtd disponível: ${qtdAtual}\nDigite a quantidade:`);
    const qtd = parseInt(q);
    if(qtd > 0 && qtd <= qtdAtual) {
        await updateDoc(doc(db, "volumes", id), { quantidade: increment(-qtd) });
        loadAll();
    } else if(q) { alert("Quantidade inválida!"); }
};

window.novoEndereco = () => {
    if(userRole !== 'admin') return;
    document.getElementById("modalTitle").innerText = "Novo Local de Armazenagem";
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("modalBody").innerHTML = `
        <input type="text" id="newRua" placeholder="Rua (Ex: A)" style="width:100%; margin-bottom:10px; text-transform:uppercase;">
        <input type="number" id="newMod" placeholder="Módulo (Ex: 10)" style="width:100%;">
    `;
    const btnSalvar = document.querySelector("#modalMaster .btn:not([onclick*='fechar'])");
    btnSalvar.onclick = async () => {
        const rua = document.getElementById("newRua").value.toUpperCase();
        const mod = document.getElementById("newMod").value;
        if(rua && mod) {
            await addDoc(collection(db, "enderecos"), { rua, modulo: parseInt(mod) });
            window.fecharModal();
            loadAll();
        }
    };
};

window.filtrarEstoque = () => {
    const fCod = document.getElementById("filtroCod")?.value.toLowerCase() || "";
    const fForn = document.getElementById("filtroForn")?.value.toLowerCase() || "";
    const fDesc = document.getElementById("filtroDesc")?.value.toLowerCase() || "";
    let c = 0;
    document.querySelectorAll(".card-endereco").forEach(card => {
        const busca = card.dataset.busca || "";
        const match = busca.includes(fCod) && busca.includes(fDesc) && (fForn === "" || busca.includes(fForn));
        card.style.display = match ? "flex" : "none";
        if(match) c++;
    });
    const countDisp = document.getElementById("countDisplay");
    if(countDisp) countDisp.innerText = c;
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
window.limparFiltros = () => {
    document.getElementById("filtroCod").value = "";
    document.getElementById("filtroForn").value = "";
    document.getElementById("filtroDesc").value = "";
    window.filtrarEstoque();
};
