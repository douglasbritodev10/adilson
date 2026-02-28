import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let usernameDB = "Usuário";

onAuthStateChanged(auth, async user => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            usernameDB = userSnap.data().nomeCompleto || "Usuário";
        }
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    try {
        // Carrega Fornecedores
        const fSnap = await getDocs(collection(db, "fornecedores"));
        const selFiltro = document.getElementById("filtroForn");
        if(selFiltro) selFiltro.innerHTML = '<option value="">Todos os Fornecedores</option>';
        fSnap.forEach(d => {
            dbState.fornecedores[d.id] = d.data().nome;
            if(selFiltro) selFiltro.innerHTML += `<option value="${d.data().nome}">${d.data().nome}</option>`;
        });

        // Carrega Produtos com Código Principal
        const pSnap = await getDocs(collection(db, "produtos"));
        pSnap.forEach(d => {
            const p = d.data();
            dbState.produtos[d.id] = { 
                nome: p.nome, 
                codigoPrincipal: p.codigo || "S/C",
                fornNome: dbState.fornecedores[p.fornecedorId] || "---"
            };
        });

        await syncUI();
    } catch (e) { console.error("Erro no carregamento:", e); }
}

async function syncUI() {
    const eSnap = await getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo")));
    dbState.enderecos = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const vSnap = await getDocs(collection(db, "volumes"));
    dbState.volumes = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    renderPendentes();
    renderEnderecos();
}

function renderEnderecos() {
    const grid = document.getElementById("gridEnderecos");
    if(!grid) return;
    grid.innerHTML = "";

    dbState.enderecos.forEach(end => {
        const vols = dbState.volumes.filter(v => v.enderecoId === end.id && v.quantidade > 0);
        
        // CÁLCULO TOTAL DO ENDEREÇO (Soma de todos os volumes ali dentro)
        const totalNoEndereco = vols.reduce((acc, curr) => acc + curr.quantidade, 0);

        const card = document.createElement('div');
        card.className = "card-endereco";
        
        // Filtro blindado contra null
        card.dataset.busca = vols.map(v => {
            const p = dbState.produtos[v.produtoId] || {};
            return `${p.nome} ${p.fornNome} ${v.descricao} ${v.codigoVol}`;
        }).join(' ').toLowerCase();

        card.innerHTML = `
            <div class="card-end-header">
                <span>RUA ${end.rua} - MOD ${end.modulo}</span>
                <span class="total-badge">TOTAL: ${totalNoEndereco}</span>
            </div>
            <div class="card-end-body">
                ${vols.map(v => {
                    const p = dbState.produtos[v.produtoId] || { nome: "---", fornNome: "---", codigoPrincipal: "---" };
                    return `
                    <div class="vol-item-box">
                        <div class="forn-tag">${p.fornNome}</div>
                        <div class="prod-main">PROD: ${p.nome} <small>(${p.codigoPrincipal})</small></div>
                        <div class="vol-detail">
                            <b>VOL:</b> ${v.descricao} <br>
                            <b>CÓD. VOL:</b> ${v.codigoVol || 'S/C'}
                        </div>
                        <div class="qtd-row">
                            <span>QTD: <b>${v.quantidade}</b></span>
                            <div class="btn-group">
                                <button onclick="window.abrirModalMover('${v.id}')" class="btn-sm">MOVER</button>
                                <button onclick="window.darSaida('${v.id}', '${v.descricao}')" class="btn-sm-danger">SAÍDA</button>
                            </div>
                        </div>
                    </div>`;
                }).join('') || '<div class="empty">Vazio</div>'}
            </div>`;
        grid.appendChild(card);
    });
    window.filtrarEstoque();
}

// --- LÓGICA DE AUTOSOMA INTELIGENTE ---
window.abrirModalMover = (volId) => {
    const vol = dbState.volumes.find(v => v.id === volId);
    if(!vol) return;

    const modal = document.getElementById("modalMaster");
    document.getElementById("modalTitle").innerText = "Guardar / Mover Volume";
    document.getElementById("modalBody").innerHTML = `
        <div class="info-mov">
            <b>${vol.descricao}</b><br>
            <small>Qtd disponível: ${vol.quantidade}</small>
        </div>
        <label>DESTINO:</label>
        <select id="selDestino" class="input-modal">
            <option value="">Selecione o Endereço...</option>
            ${dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo}</option>`).join('')}
        </select>
        <label>QUANTIDADE:</label>
        <input type="number" id="qtdMover" value="${vol.quantidade}" min="1" max="${vol.quantidade}" class="input-modal">
    `;
    modal.style.display = "flex";

    document.getElementById("btnConfirmarModal").onclick = async () => {
        const destinoId = document.getElementById("selDestino").value;
        const qtd = parseInt(document.getElementById("qtdMover").value);

        if(!destinoId || isNaN(qtd) || qtd <= 1 || qtd > vol.quantidade) {
             // Validação básica
        }

        try {
            // BUSCA SE JÁ EXISTE O MESMO VOLUME NO DESTINO (SOMA INTELIGENTE)
            const destinoExistente = dbState.volumes.find(v => 
                v.enderecoId === destinoId && 
                v.produtoId === vol.produtoId && 
                v.descricao === vol.descricao
            );

            if (destinoExistente) {
                // Se já existe, soma na mesma linha (25 + 25 = 50)
                await updateDoc(doc(db, "volumes", destinoExistente.id), {
                    quantidade: increment(qtd),
                    ultimaMovimentacao: serverTimestamp()
                });
            } else {
                // Se não existe, cria novo registro nesse endereço
                await addDoc(collection(db, "volumes"), {
                    produtoId: vol.produtoId,
                    descricao: vol.descricao,
                    codigoVol: vol.codigoVol || "",
                    quantidade: qtd,
                    enderecoId: destinoId,
                    ultimaMovimentacao: serverTimestamp()
                });
            }

            // Subtrai do local de origem
            await updateDoc(doc(db, "volumes", vol.id), {
                quantidade: increment(-qtd),
                ultimaMovimentacao: serverTimestamp()
            });

            // Registro para Relatório
            await addDoc(collection(db, "movimentacoes"), {
                produto: vol.descricao, tipo: "Armazenagem", quantidade: qtd,
                detalhe: `Para: ${destinoId}`, usuario: usernameDB, data: serverTimestamp()
            });

            modal.style.display = "none";
            syncUI();
        } catch (e) { console.error(e); }
    };
};

function renderPendentes() {
    const area = document.getElementById("pendentesArea");
    if(!area) return;
    area.innerHTML = "";
    dbState.volumes.forEach(v => {
        if (v.quantidade > 0 && !v.enderecoId) {
            const p = dbState.produtos[v.produtoId] || { nome: "---", fornNome: "---" };
            area.innerHTML += `
                <div class="card-pendente">
                    <small>${p.fornNome}</small>
                    <b>${p.nome}</b>
                    <p>${v.descricao}</p>
                    <div style="display:flex; justify-content:space-between;">
                        <span>Qtd: ${v.quantidade}</span>
                        <button onclick="window.abrirModalMover('${v.id}')">GUARDAR</button>
                    </div>
                </div>`;
        }
    });
}

window.filtrarEstoque = () => {
    const fCod = document.getElementById("filtroCod")?.value.toLowerCase() || "";
    const fForn = document.getElementById("filtroForn")?.value.toLowerCase() || "";
    const fDesc = document.getElementById("filtroDesc")?.value.toLowerCase() || "";
    
    let c = 0;
    document.querySelectorAll(".card-endereco").forEach(card => {
        const busca = (card.dataset.busca || "").toLowerCase();
        const match = busca.includes(fCod) && busca.includes(fDesc) && (fForn === "" || busca.includes(fForn));
        card.style.display = match ? "flex" : "none";
        if(match) c++;
    });
    if(document.getElementById("countDisplay")) document.getElementById("countDisplay").innerText = c;
};
