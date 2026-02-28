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
            const btnEnd = document.getElementById("btnNovoEnd");
            if(btnEnd) btnEnd.style.display = (userRole === 'admin') ? 'block' : 'none';
        }
        const display = document.getElementById("userDisplay");
        if(display) display.innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB} (${userRole.toUpperCase()})`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

// --- 2. CARREGAMENTO DE DADOS ---
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
                codPrincipal: p.codigo || "S/C",
                forn: dbState.fornecedores[p.fornecedorId] || "---" 
            };
        });

        await syncUI();
    } catch (e) { console.error("Erro no loadAll:", e); }
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

// --- 3. RENDERIZAÇÃO DOS PENDENTES (Lado Esquerdo) ---
function renderPendentes() {
    const area = document.getElementById("listaPendentes");
    const count = document.getElementById("countPendentes");
    if(!area) return;

    // Filtra volumes que tenham quantidade > 0 e NÃO tenham endereço
    const pendentes = dbState.volumes.filter(v => v.quantidade > 0 && (!v.enderecoId || v.enderecoId === ""));
    
    if(count) count.innerText = pendentes.length;
    
    area.innerHTML = pendentes.map(v => {
        const p = dbState.produtos[v.produtoId] || {nome:"Produto não encontrado", forn:"---"};
        return `
            <div class="vol-item-pendente" style="background:rgba(255,255,255,0.05); padding:10px; border-radius:8px; margin-bottom:10px; border-left:4px solid var(--warning);">
                <div style="flex:1">
                    <small style="color:var(--warning)">${p.forn}</small><br>
                    <strong style="color:white;">${p.nome}</strong><br>
                    <small style="color:#aaa;">${v.descricao} (${v.codigo}) | Qtd: ${v.quantidade}</small>
                </div>
                ${userRole !== 'leitor' ? 
                    `<button onclick="window.abrirModalMover('${v.id}')" style="background:var(--warning); border:none; padding:5px 8px; border-radius:4px; cursor:pointer; font-weight:bold; margin-top:5px;">ENDEREÇAR</button>` : ''}
            </div>
        `;
    }).join('');
}

// --- 4. RENDERIZAÇÃO DO GRID DE ESTOQUE ---
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
            const p = dbState.produtos[v.produtoId] || {nome:"---", forn:"---", codPrincipal:"---"};
            buscaTxt += `${p.nome} ${p.forn} ${v.descricao} ${v.codigo} `.toLowerCase();
            return `
                <div class="vol-item" style="border-bottom:1px solid rgba(0,0,0,0.05); padding:8px 0;">
                    <div style="flex:1">
                        <small style="color:var(--primary); font-weight:bold;">${p.forn}</small><br>
                        <strong>${p.nome}</strong> <small>(${p.codPrincipal})</small><br>
                        <span style="font-size:12px; color:#666;">${v.descricao} <small>(${v.codigo})</small></span><br>
                        <b style="color:var(--success)">Qtd: ${v.quantidade}</b>
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
            <div class="card-header" style="background:var(--primary); color:white; padding:8px; border-radius:5px 5px 0 0; display:flex; justify-content:space-between;">
                <span>RUA ${end.rua} - MOD ${end.modulo}</span>
                ${userRole === 'admin' ? `<i class="fas fa-trash" onclick="window.deletarLocal('${end.id}')" style="cursor:pointer; font-size:12px;"></i>` : ''}
            </div>
            <div style="padding:10px;">
                ${htmlVols || '<div style="text-align:center; color:#999; padding:10px;">Vazio</div>'}
            </div>
        `;
        grid.appendChild(card);
    });
    window.filtrarEstoque();
}

// --- 5. LÓGICA DE MOVIMENTAÇÃO (O CORAÇÃO DO SISTEMA) ---
window.abrirModalMover = (volId) => {
    if(userRole === 'leitor') return;
    const vol = dbState.volumes.find(v => v.id === volId);
    const p = dbState.produtos[vol.produtoId];
    
    document.getElementById("modalTitle").innerText = "Movimentar Volume";
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("modalBody").innerHTML = `
        <input type="hidden" id="modalVolId" value="${volId}">
        <p><strong>Item:</strong> ${p.nome}<br><small>${vol.descricao} (${vol.codigo})</small></p>
        <label>Quantidade p/ Mover (Total: ${vol.quantidade}):</label>
        <input type="number" id="qtdMover" value="${vol.quantidade}" min="1" max="${vol.quantidade}" style="width:100%; margin-bottom:15px; padding:8px;">
        
        <label>Endereço de Destino:</label>
        <select id="selDestino" style="width:100%; padding:8px;">
            <option value="">-- Selecione --</option>
            ${dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo}</option>`).join('')}
            <option value="">-- VOLTAR PARA PENDENTES --</option>
        </select>
    `;
    const btnSalvar = document.querySelector("#modalMaster .btn-primary") || document.querySelector("#modalMaster .btn:not([onclick*='fechar'])");
    btnSalvar.onclick = window.confirmarMovimentacao;
};

window.confirmarMovimentacao = async () => {
    const volId = document.getElementById("modalVolId").value;
    const destId = document.getElementById("selDestino").value;
    const qtdMover = parseInt(document.getElementById("qtdMover").value);

    if (isNaN(qtdMover) || qtdMover <= 0) return alert("Quantidade inválida!");

    const volOrigem = dbState.volumes.find(v => v.id === volId);
    if(qtdMover > volOrigem.quantidade) return alert("Quantidade indisponível!");

    try {
        // PROCURA SE JÁ EXISTE O MESMO VOLUME NO DESTINO (MESMO PRODUTO + MESMA DESCRIÇÃO)
        const destinoExistente = dbState.volumes.find(v => 
            v.enderecoId === destId && 
            v.produtoId === volOrigem.produtoId && 
            v.descricao === volOrigem.descricao &&
            v.codigo === volOrigem.codigo
        );

        if (destinoExistente) {
            // SE EXISTE, SOMA
            await updateDoc(doc(db, "volumes", destinoExistente.id), {
                quantidade: increment(qtdMover)
            });
        } else {
            // SE NÃO EXISTE, CRIA NOVO REGISTRO NO DESTINO
            await addDoc(collection(db, "volumes"), {
                produtoId: volOrigem.produtoId,
                codigo: volOrigem.codigo,
                descricao: volOrigem.descricao,
                quantidade: qtdMover,
                enderecoId: destId, // Se destId for "", ele volta para pendentes automaticamente
                dataMov: serverTimestamp()
            });
        }

        // SUBTRAI DA ORIGEM
        const novaQtdOrigem = volOrigem.quantidade - qtdMover;
        if(novaQtdOrigem <= 0) {
            await deleteDoc(doc(db, "volumes", volId));
        } else {
            await updateDoc(doc(db, "volumes", volId), {
                quantidade: novaQtdOrigem
            });
        }

        window.fecharModal();
        loadAll();
    } catch (e) { console.error("Erro ao mover:", e); }
};

// --- 6. SAÍDA E OUTROS ---
window.darSaida = async (id, desc, qtdAtual) => {
    if(userRole === 'leitor') return;
    const q = prompt(`DAR SAÍDA: ${desc}\nQtd atual: ${qtdAtual}\n\nQuantas unidades saíram?`);
    const qtd = parseInt(q);
    if(qtd > 0 && qtd <= qtdAtual) {
        if(qtd === qtdAtual) {
            await deleteDoc(doc(db, "volumes", id));
        } else {
            await updateDoc(doc(db, "volumes", id), { quantidade: increment(-qtd) });
        }
        loadAll();
    } else if(q) { alert("Quantidade inválida!"); }
};

window.novoEndereco = async () => {
    if(userRole !== 'admin') return;
    const rua = prompt("Digite a RUA (Ex: A):")?.toUpperCase();
    const mod = prompt("Digite o MÓDULO (Ex: 01):");
    if(rua && mod) {
        await addDoc(collection(db, "enderecos"), { rua, modulo: parseInt(mod) });
        loadAll();
    }
};

window.deletarLocal = async (id) => {
    if(userRole !== 'admin') return;
    if(confirm("Excluir este endereço? Volumes nele voltarão para PENDENTES.")) {
        const afetados = dbState.volumes.filter(v => v.enderecoId === id);
        for(let v of afetados) {
            await updateDoc(doc(db, "volumes", v.id), { enderecoId: "" });
        }
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
    if(document.getElementById("countDisplay")) document.getElementById("countDisplay").innerText = c;
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
window.limparFiltros = () => {
    document.getElementById("filtroCod").value = "";
    document.getElementById("filtroForn").value = "";
    document.getElementById("filtroDesc").value = "";
    window.filtrarEstoque();
};
