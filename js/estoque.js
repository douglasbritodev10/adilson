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

        const fSel = document.getElementById("filtroForn");
        if(fSel) {
            fSel.innerHTML = '<option value="">Todos os Fornecedores</option>';
            Object.values(dbState.fornecedores).sort().forEach(nome => {
                fSel.innerHTML += `<option value="${nome.toLowerCase()}">${nome}</option>`;
            });
        }

        await syncUI();
    } catch (e) { console.error("Erro ao carregar dados:", e); }
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

// --- FUNÇÃO RENDERIZAR PENDENTES (UNIFICADA E CORRIGIDA) ---
function renderPendentes() {
    const area = document.getElementById("listaPendentes");
    const count = document.getElementById("countPendentes");
    if(!area) return;

    const pendentes = dbState.volumes.filter(v => v.quantidade > 0 && (!v.enderecoId || v.enderecoId === ""));
    
    if(count) count.innerText = pendentes.length;
    
    area.innerHTML = pendentes.map(v => {
        const p = dbState.produtos[v.produtoId] || {nome:"Produto Não Encontrado"};
        return `
            <div class="vol-item-pendente" style="background:rgba(255,255,255,0.1); padding:10px; border-radius:5px; margin-bottom:8px; border-left:4px solid var(--warning);">
                <div style="flex:1">
                    <strong style="color:white;">${p.nome}</strong><br>
                    <small style="color:#ccc;">${v.descricao} | Qtd: ${v.quantidade}</small>
                </div>
                ${userRole !== 'leitor' ? 
                    `<button onclick="window.abrirModalMover('${v.id}')" style="background:var(--warning); border:none; border-radius:3px; cursor:pointer; padding:5px 10px; font-weight:bold;">MOVER</button>` : ''}
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
                            <button onclick="window.abrirModalMover('${v.id}')" title="Mover"><i class="fas fa-exchange-alt"></i></button>
                            <button onclick="window.darSaida('${v.id}', '${v.descricao}', ${v.quantidade})" style="color:var(--danger)" title="Saída"><i class="fas fa-sign-out-alt"></i></button>
                        </div>
                    ` : ''}
                </div>`;
        }).join('');

        card.dataset.busca = buscaTxt;
        card.innerHTML = `
            <div class="card-header">
                <span>RUA ${end.rua} - MOD ${end.modulo}</span>
                ${userRole === 'admin' ? `<i class="fas fa-trash" onclick="window.deletarLocal('${end.id}')" style="cursor:pointer; font-size:12px; opacity:0.6;"></i>` : ''}
            </div>
            ${htmlVols || '<div style="text-align:center; padding:10px; color:#999;">Vazio</div>'}
        `;
        grid.appendChild(card);
    });
    window.filtrarEstoque();
}

// --- MODAIS E AÇÕES ---
window.abrirModalMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    const p = dbState.produtos[vol.produtoId];
    
    document.getElementById("modalTitle").innerText = "Endereçar Volume";
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("modalBody").innerHTML = `
        <input type="hidden" id="modalVolId" value="${volId}">
        <p style="margin-bottom:10px;"><strong>Item:</strong> ${p.nome}<br><small>${vol.descricao}</small></p>
        <label>Quantidade a Mover (Disponível: ${vol.quantidade}):</label>
        <input type="number" id="qtdMover" value="${vol.quantidade}" min="1" max="${vol.quantidade}" style="width:100%; margin-bottom:15px;">
        
        <label>Destino:</label>
        <select id="selDestino" style="width:100%;">
            <option value="">-- Selecione o Endereço --</option>
            ${dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo}</option>`).join('')}
        </select>
    `;
};

window.confirmarMovimentacao = async () => {
    const volId = document.getElementById("modalVolId").value;
    const destId = document.getElementById("selDestino").value;
    const qtdMover = parseInt(document.getElementById("qtdMover").value);

    if (!destId || isNaN(qtdMover) || qtdMover <= 0) return alert("Dados inválidos!");

    const volOrigem = dbState.volumes.find(v => v.id === volId);
    if(qtdMover > volOrigem.quantidade) return alert("Quantidade insuficiente!");

    try {
        const destinoExistente = dbState.volumes.find(v => 
            v.enderecoId === destId && 
            v.produtoId === volOrigem.produtoId && 
            v.descricao === volOrigem.descricao
        );

        if (destinoExistente) {
            await updateDoc(doc(db, "volumes", destinoExistente.id), {
                quantidade: increment(qtdMover)
            });
        } else {
            await addDoc(collection(db, "volumes"), {
                produtoId: volOrigem.produtoId,
                codigo: volOrigem.codigo,
                descricao: volOrigem.descricao,
                quantidade: qtdMover,
                enderecoId: destId,
                dataMov: serverTimestamp()
            });
        }

        const novaQtd = volOrigem.quantidade - qtdMover;
        await updateDoc(doc(db, "volumes", volId), {
            quantidade: novaQtd
        });

        window.fecharModal();
        loadAll();
    } catch (e) { console.error(e); }
};

window.novoEndereco = () => {
    document.getElementById("modalTitle").innerText = "Novo Endereço";
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("modalBody").innerHTML = `
        <label>Rua:</label>
        <input type="text" id="newRua" placeholder="Ex: A" style="width:100%; margin-bottom:10px;">
        <label>Módulo:</label>
        <input type="number" id="newMod" placeholder="Ex: 1" style="width:100%;">
    `;
    // Altera o botão de salvar do modal para a função de endereço
    const btnSalvar = document.querySelector(".modal-content .btn:not([onclick*='fechar'])");
    btnSalvar.onclick = window.salvarEndereco;
};

window.salvarEndereco = async () => {
    const rua = document.getElementById("newRua").value.toUpperCase();
    const mod = document.getElementById("newMod").value;
    if(!rua || !mod) return alert("Preencha tudo!");
    
    await addDoc(collection(db, "enderecos"), { rua, modulo: parseInt(mod) });
    window.fecharModal();
    loadAll();
};

window.darSaida = async (id, desc, qtdAtual) => {
    const q = prompt(`Dar saída em: ${desc}\nQtd disponível: ${qtdAtual}\n\nQuanto deseja retirar?`);
    const qtdSaindo = parseInt(q);

    if(qtdSaindo > 0 && qtdSaindo <= qtdAtual) {
        await updateDoc(doc(db, "volumes", id), { 
            quantidade: increment(-qtdSaindo) 
        });
        loadAll();
    } else if(q !== null) {
        alert("Quantidade inválida!");
    }
};

window.deletarLocal = async (id) => {
    if(userRole !== 'admin') return;
    if(confirm("Excluir endereço permanentemente? Os volumes nele ficarão sem endereço.")) {
        await deleteDoc(doc(db, "enderecos", id));
        loadAll();
    }
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
