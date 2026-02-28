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
            const btnEnd = document.getElementById("btnNovoEnd");
            if(btnEnd) btnEnd.style.display = (userRole === 'admin') ? 'block' : 'none';
        }
        const display = document.getElementById("userDisplay");
        if(display) display.innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB}`;
        loadAll();
    } else { window.location.href = "index.html"; }
});

async function loadAll() {
    try {
        const [fSnap, pSnap, eSnap, vSnap] = await Promise.all([
            getDocs(collection(db, "fornecedores")),
            getDocs(collection(db, "produtos")),
            getDocs(query(collection(db, "enderecos"), orderBy("rua"), orderBy("modulo"))),
            getDocs(collection(db, "volumes"))
        ]);

        dbState.fornecedores = {};
        fSnap.forEach(d => dbState.fornecedores[d.id] = { nome: d.data().nome });
        
        dbState.produtos = {};
        pSnap.forEach(d => dbState.produtos[d.id] = { 
            nome: d.data().nome, 
            codigo: d.data().codigo || "S/C", 
            fornecedorId: d.data().fornecedorId 
        });

        dbState.enderecos = eSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        dbState.volumes = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const selForn = document.getElementById("filtroForn");
        if(selForn) {
            selForn.innerHTML = '<option value="">Todos os Fornecedores</option>';
            const nomes = [...new Set(Object.values(dbState.fornecedores).map(f => f.nome))].sort();
            nomes.forEach(n => selForn.innerHTML += `<option value="${n}">${n}</option>`);
        }

        syncUI();
    } catch (e) { console.error("Erro no loadAll:", e); }
}

function syncUI() {
    const grid = document.getElementById("gridEnderecos");
    const pendentes = document.getElementById("listaPendentes");
    if(!grid || !pendentes) return;

    grid.innerHTML = "";
    pendentes.innerHTML = "";

    // 1. LISTA PENDENTES
    const falta = dbState.volumes.filter(v => (!v.enderecoId || v.enderecoId === "") && v.quantidade > 0);
    document.getElementById("countPendentes").innerText = falta.length;

    falta.forEach(v => {
        const prod = dbState.produtos[v.produtoId] || { nome: "???", codigo: "???" };
        const forn = dbState.fornecedores[prod.fornecedorId] || { nome: "???" };
        
        const div = document.createElement("div");
        div.className = "item-pendente";
        div.innerHTML = `
            <small style="color:var(--primary); font-weight:bold;">${forn.nome}</small><br>
            <span style="font-size:11px;"><b>Prod: ${prod.codigo}</b></span><br>
            <span style="font-size:12px;"><b>Vol: ${v.codigo || 'S/C'}</b> - ${v.descricao}</span><br>
            <small>Qtd: <b>${v.quantidade}</b></small>
            ${userRole !== 'leitor' ? `<button onclick="window.abrirAcao('${v.id}', 'guardar')" class="btn" style="background:var(--success); color:white; width:100%; margin-top:5px; padding:4px; font-size:10px;">GUARDAR</button>` : ''}
        `;
        pendentes.appendChild(div);
    });

    // 2. GRID DE ENDEREÇOS
    dbState.enderecos.forEach(e => {
        const vols = dbState.volumes.filter(v => v.enderecoId === e.id && v.quantidade > 0);
        const card = document.createElement("div");
        card.className = "card-endereco";
        
        let totalUnidades = 0;
        let htmlItens = "";
        let buscaTexto = `${e.rua} ${e.modulo} ${e.nivel} `.toLowerCase();

        vols.forEach(v => {
            const prod = dbState.produtos[v.produtoId] || { nome: "???", codigo: "???" };
            const forn = dbState.fornecedores[prod.fornecedorId] || { nome: "???" };
            totalUnidades += v.quantidade;
            buscaTexto += `${prod.nome} ${prod.codigo} ${forn.nome} ${v.descricao} ${v.codigo || ''} `.toLowerCase();

            htmlItens += `
                <div class="item-row">
                    <div class="item-info">
                        <div style="font-size: 10px; color: var(--primary); font-weight: bold;">P: ${prod.codigo} - ${prod.nome}</div>
                        <div style="font-size: 11px;"><b style="color:#333;">V: ${v.codigo || 'S/C'}</b> - ${v.descricao}</div>
                        <div style="font-size: 10px; color: #666;">${forn.nome} | <b style="color:var(--success)">Qtd: ${v.quantidade}</b></div>
                    </div>
                    ${userRole !== 'leitor' ? `
                        <div style="display:flex; align-items: center;">
                            <button onclick="window.abrirAcao('${v.id}', 'mover')" class="btn-mini" style="background:var(--info)" title="Mover"><i class="fas fa-exchange-alt"></i></button>
                            <button onclick="window.abrirAcao('${v.id}', 'saida')" class="btn-mini" style="background:var(--danger)" title="Saída"><i class="fas fa-sign-out-alt"></i></button>
                        </div>
                    ` : ''}
                </div>
            `;
        });

        card.dataset.busca = buscaTexto;
        card.innerHTML = `
            <div class="card-header">RUA ${e.rua} - MOD ${e.modulo} - NIV ${e.nivel}</div>
            <div class="card-body">${htmlItens || '<small style="color:#ccc">Vazio</small>'}</div>
            <div class="card-footer">Total: ${totalUnidades} un</div>
        `;
        grid.appendChild(card);
    });
    window.filtrarEstoque();
}

window.abrirAcao = (volId, tipo) => {
    if(userRole === 'leitor') return;
    const vol = dbState.volumes.find(v => v.id === volId);
    const modal = document.getElementById("modalMaster");
    const body = document.getElementById("modalBody");
    
    body.innerHTML = `
        <div style="font-size:12px; background:#f0f7ff; padding:10px; border-radius:5px; margin-bottom:15px;">
            Item: <b>${vol.descricao}</b><br>Saldo Atual: <b>${vol.quantidade}</b>
        </div>
        <label>QUANTIDADE PARA ESTA AÇÃO:</label>
        <input type="number" id="qtdAcao" value="${vol.quantidade}" min="1" max="${vol.quantidade}" style="width:100%; margin-bottom:15px;">
    `;

    if (tipo === 'guardar' || tipo === 'mover') {
        document.getElementById("modalTitle").innerText = tipo === 'guardar' ? "Endereçar Volume" : "Mover Volume";
        let opts = dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo} - NIV ${e.nivel}</option>`).join('');
        body.innerHTML += `<label>ENDEREÇO DESTINO:</label><select id="selDestino" style="width:100%;">${opts}</select>`;
    } else {
        document.getElementById("modalTitle").innerText = "Dar Saída";
    }

    modal.style.display = "flex";

    document.getElementById("btnConfirmar").onclick = async () => {
        const qtd = parseInt(document.getElementById("qtdAcao").value);
        if(qtd <= 0 || qtd > vol.quantidade) return alert("Quantidade inválida!");

        try {
            if (tipo === 'saida') {
                await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtd), ultimaMovimentacao: serverTimestamp() });
                await addDoc(collection(db, "movimentacoes"), { 
                    tipo: "SAÍDA", produto: vol.descricao, quantidade: qtd, usuario: usernameDB, data: serverTimestamp() 
                });
            } 
            else {
                const destinoId = document.getElementById("selDestino").value;
                const endDestino = dbState.enderecos.find(e => e.id === destinoId);
                const localizacao = `R${endDestino.rua}-M${endDestino.modulo}-N${endDestino.nivel}`;

                // --- LÓGICA DE SOMAR SE JÁ EXISTIR NO DESTINO ---
                const volExistente = dbState.volumes.find(v => 
                    v.enderecoId === destinoId && 
                    v.produtoId === vol.produtoId && 
                    v.codigo === vol.codigo && 
                    v.descricao === vol.descricao
                );

                if (volExistente) {
                    // Já existe o mesmo volume lá, soma a quantidade no existente
                    await updateDoc(doc(db, "volumes", volExistente.id), { 
                        quantidade: increment(qtd), 
                        ultimaMovimentacao: serverTimestamp() 
                    });
                } else {
                    // Não existe igual, cria um novo registro ou atualiza o atual
                    if (qtd === vol.quantidade && (tipo === 'mover' || tipo === 'guardar')) {
                        await updateDoc(doc(db, "volumes", volId), { enderecoId: destinoId, ultimaMovimentacao: serverTimestamp() });
                    } else {
                        await addDoc(collection(db, "volumes"), {
                            produtoId: vol.produtoId, 
                            descricao: vol.descricao, 
                            codigo: vol.codigo || "",
                            quantidade: qtd, 
                            enderecoId: destinoId, 
                            ultimaMovimentacao: serverTimestamp()
                        });
                    }
                }

                // Se moveu apenas parte, subtrai do original (caso não tenha mudado o original inteiro)
                if (qtd < vol.quantidade) {
                    await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtd) });
                } else if (volExistente && qtd === vol.quantidade) {
                    // Se moveu tudo e somou no destino, apaga o registro original que ficou zerado
                    await deleteDoc(doc(db, "volumes", volId));
                }

                // REGISTRO NO HISTÓRICO
                await addDoc(collection(db, "movimentacoes"), { 
                    tipo: tipo.toUpperCase(), 
                    produto: vol.descricao, 
                    quantidade: qtd, 
                    destino: localizacao,
                    usuario: usernameDB, 
                    data: serverTimestamp() 
                });
            }
            window.fecharModal(); loadAll();
        } catch (err) { console.error(err); alert("Erro ao processar!"); }
    };
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.filtrarEstoque = () => { /* ... sua função de filtro ... */ };
window.limparFiltros = () => { /* ... sua função de limpar ... */ };
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
