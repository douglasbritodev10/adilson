import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let usernameDB = "Usuário";
let userRole = "leitor";

onAuthStateChanged(auth, async user => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const data = userSnap.data();
            usernameDB = data.nomeCompleto || "Usuário";
            userRole = data.role || "leitor";
            aplicarPermissoes(userRole);
        }
        const display = document.getElementById("userDisplay");
        if(display) display.innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB}`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

function aplicarPermissoes(role) {
    const painel = document.getElementById("painelAdmin");
    if(painel) painel.style.display = (role === 'admin') ? 'flex' : 'none';
}

async function loadAll() {
    const [fSnap, pSnap, eSnap, vSnap] = await Promise.all([
        getDocs(collection(db, "fornecedores")),
        getDocs(collection(db, "produtos")),
        getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo"))),
        getDocs(collection(db, "volumes"))
    ]);

    dbState.fornecedores = {};
    fSnap.forEach(d => dbState.fornecedores[d.id] = d.data().nome);
    
    dbState.produtos = {};
    pSnap.forEach(d => dbState.produtos[d.id] = d.data());

    dbState.enderecos = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    dbState.volumes = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const sel = document.getElementById("filtroForn");
    if(sel && sel.options.length <= 1) {
        Object.values(dbState.fornecedores).forEach(nome => {
            sel.innerHTML += `<option value="${nome}">${nome}</option>`;
        });
    }
    syncUI();
}

function syncUI() {
    const grid = document.getElementById("gridEnderecos");
    const pendentes = document.getElementById("listaPendentes");
    if(!grid || !pendentes) return;

    grid.innerHTML = "";
    pendentes.innerHTML = "";

    // 1. Renderizar Pendentes (Aguardando Endereçamento)
    dbState.volumes.filter(v => !v.enderecoId || v.enderecoId === "").forEach(v => {
        const p = dbState.produtos[v.produtoId] || { nome: "Produto Excluído", fornecedorId: "" };
        const fNome = dbState.fornecedores[p.fornecedorId] || "---";
        
        const div = document.createElement("div");
        div.className = "item-pendente";
        div.innerHTML = `
            <div style="flex:1">
                <small>${fNome}</small><br>
                <b>${v.descricao}</b><br>
                <span class="badge-qtd">Qtd: ${v.quantidade}</span>
            </div>
            <button onclick="window.abrirMover('${v.id}')" class="btn" style="background:var(--success); color:white;">GUARDAR</button>
        `;
        pendentes.appendChild(div);
    });

    // 2. Renderizar Endereços e seus conteúdos
    dbState.enderecos.forEach(e => {
        const vols = dbState.volumes.filter(v => v.enderecoId === e.id);
        const card = document.createElement("div");
        card.className = "card-endereco";
        card.dataset.busca = `${e.rua} ${e.modulo} ${vols.map(v => v.descricao).join(" ")}`.toLowerCase();

        let itensHTML = vols.map(v => `
            <div class="vol-item">
                <span>${v.descricao} (<b>${v.quantidade}</b>)</span>
                <div style="display:flex; gap:5px;">
                    <button onclick="window.abrirMover('${v.id}')" title="Mover" style="border:none; background:none; color:var(--primary); cursor:pointer;"><i class="fas fa-exchange-alt"></i></button>
                    <button onclick="window.abrirSaida('${v.id}')" title="Saída" style="border:none; background:none; color:var(--danger); cursor:pointer;"><i class="fas fa-sign-out-alt"></i></button>
                </div>
            </div>
        `).join("");

        card.innerHTML = `
            <div class="card-header">
                <span>RUA <b>${e.rua}</b> - MOD <b>${e.modulo}</b> - NÍV <b>${e.nivel}</b></span>
                ${userRole === 'admin' ? `<i class="fas fa-trash" onclick="window.deletarLocal('${e.id}')" style="cursor:pointer; opacity:0.5"></i>` : ''}
            </div>
            <div class="card-body">${itensHTML || '<small style="color:#ccc">Vazio</small>'}</div>
        `;
        grid.appendChild(card);
    });
    window.filtrarEstoque();
}

// --- LÓGICA DE MOVER / GUARDAR COM DESMEMBRAMENTO ---
window.abrirMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = "Endereçar Volume";
    
    let opts = dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo} - NIV ${e.nivel}</option>`).join('');
    
    document.getElementById("modalBody").innerHTML = `
        <p>Produto: <b>${vol.descricao}</b></p>
        <p>Disponível para mover: <span id="maxQtd">${vol.quantidade}</span></p>
        <label>QUANTIDADE A GUARDAR:</label>
        <input type="number" id="qtdMover" value="${vol.quantidade}" min="1" max="${vol.quantidade}" style="width:100%; font-size:18px; text-align:center; margin-bottom:15px;">
        <label>ENDEREÇO DESTINO:</label>
        <select id="selDestino" style="width:100%;">${opts}</select>
    `;
    modal.style.display = "flex";

    document.getElementById("btnConfirmar").onclick = async () => {
        const destinoId = document.getElementById("selDestino").value;
        const qtdAcoes = parseInt(document.getElementById("qtdMover").value);

        if(qtdAcoes <= 0 || qtdAcoes > vol.quantidade) {
            return alert("Quantidade inválida! Você não pode guardar mais do que tem disponível.");
        }

        try {
            // Se a quantidade for IGUAL ao total, apenas atualizamos o endereço
            if (qtdAcoes === vol.quantidade) {
                await updateDoc(doc(db, "volumes", volId), { 
                    enderecoId: destinoId,
                    ultimaMovimentacao: serverTimestamp() 
                });
            } 
            // Se for MENOR, desmembramos: diminui do original e cria um novo no endereço
            else {
                // 1. Subtrai do original (que continua pendente ou no endereço antigo)
                await updateDoc(doc(db, "volumes", volId), { 
                    quantidade: increment(-qtdAcoes),
                    ultimaMovimentacao: serverTimestamp()
                });

                // 2. Cria um novo registro já endereçado
                await addDoc(collection(db, "volumes"), {
                    produtoId: vol.produtoId,
                    descricao: vol.descricao,
                    codigo: vol.codigo || "",
                    quantidade: qtdAcoes,
                    enderecoId: destinoId,
                    ultimaMovimentacao: serverTimestamp()
                });
            }

            // Histórico
            await addDoc(collection(db, "movimentacoes"), {
                tipo: "Endereçamento",
                produto: vol.descricao,
                quantidade: qtdAcoes,
                usuario: usernameDB,
                data: serverTimestamp(),
                detalhe: "Movido para novo endereço"
            });

            window.fecharModal();
            loadAll();
        } catch (e) {
            console.error(e);
            alert("Erro ao movimentar.");
        }
    };
};

window.abrirSaida = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = "Dar Saída";
    document.getElementById("modalBody").innerHTML = `
        <p>Produto: <b>${vol.descricao}</b></p>
        <input type="number" id="qtdSaida" value="${vol.quantidade}" min="1" max="${vol.quantidade}" style="width:100%; text-align:center;">
    `;
    modal.style.display = "flex";

    document.getElementById("btnConfirmar").onclick = async () => {
        const q = parseInt(document.getElementById("qtdSaida").value);
        if(q > 0 && q <= vol.quantidade) {
            await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-q) });
            await addDoc(collection(db, "movimentacoes"), { 
                produto: vol.descricao, tipo: "Saída", quantidade: q, usuario: usernameDB, data: serverTimestamp() 
            });
            window.fecharModal();
            loadAll();
        }
    };
};

window.filtrarEstoque = () => {
    const fCod = document.getElementById("filtroCod").value.toLowerCase();
    const fForn = document.getElementById("filtroForn").value.toLowerCase();
    const fDesc = document.getElementById("filtroDesc").value.toLowerCase();
    let c = 0;

    document.querySelectorAll(".card-endereco").forEach(card => {
        const b = card.dataset.busca;
        const m = b.includes(fCod) && (fForn === "" || b.includes(fForn)) && b.includes(fDesc);
        card.style.display = m ? "block" : "none";
        if(m) c++;
    });
    const disp = document.getElementById("countDisplay");
    if(disp) disp.innerText = c;
};

window.limparFiltros = () => {
    document.getElementById("filtroCod").value = "";
    document.getElementById("filtroForn").value = "";
    document.getElementById("filtroDesc").value = "";
    window.filtrarEstoque();
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
