import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, orderBy, serverTimestamp, increment 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let dbState = { fornecedores: {}, produtos: {}, enderecos: [], volumes: [] };
let usernameDB = "Usuário";
let userRole = "leitor";

// --- CONTROLE DE ACESSO E PERMISSÕES ---
onAuthStateChanged(auth, async user => {
    if (user) {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            const data = userSnap.data();
            usernameDB = data.nomeCompleto || "Usuário";
            userRole = data.role || "leitor";
            
            // Exibe botão de novo endereço apenas para Admins
            const btnEnd = document.getElementById("btnNovoEnd");
            if(btnEnd) btnEnd.style.display = (userRole === 'admin') ? 'block' : 'none';
        }
        const display = document.getElementById("userDisplay");
        if(display) display.innerHTML = `<i class="fas fa-user-circle"></i> ${usernameDB} (${userRole.toUpperCase()})`;
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
    } catch (e) { console.error("Erro ao carregar dados:", e); }
}

function syncUI() {
    const grid = document.getElementById("gridEnderecos");
    const pendentes = document.getElementById("listaPendentes");
    if(!grid || !pendentes) return;

    grid.innerHTML = "";
    pendentes.innerHTML = "";

    // 1. LISTA DE PENDENTES (LADO ESQUERDO)
    const falta = dbState.volumes.filter(v => (!v.enderecoId || v.enderecoId === "") && v.quantidade > 0);
    document.getElementById("countPendentes").innerText = falta.length;

    falta.forEach(v => {
        const prod = dbState.produtos[v.produtoId] || { nome: "Produto não encontrado", codigo: "S/C" };
        const forn = dbState.fornecedores[prod.fornecedorId] || { nome: "Sem Fornecedor" };
        
        const div = document.createElement("div");
        div.className = "item-pendente";
        div.innerHTML = `
            <small style="color:var(--primary); font-weight:bold; text-transform:uppercase;">${forn.nome}</small><br>
            <span style="font-size:11px;"><b>Prod: ${prod.codigo}</b> - ${prod.nome}</span><br>
            <span style="font-size:11px;"><b>Vol: ${v.codigo || 'S/C'}</b> - ${v.descricao}</span><br>
            <small>Qtd: <b>${v.quantidade}</b></small>
            ${userRole !== 'leitor' ? `<button onclick="window.abrirAcao('${v.id}', 'guardar')" class="btn" style="background:var(--success); color:white; width:100%; margin-top:5px; padding:4px; font-size:10px;">GUARDAR</button>` : ''}
        `;
        pendentes.appendChild(div);
    });

    // 2. GRID DE ENDEREÇOS (CENTRO)
    dbState.enderecos.forEach(e => {
        const vols = dbState.volumes.filter(v => v.enderecoId === e.id && v.quantidade > 0);
        const card = document.createElement("div");
        card.className = "card-endereco";
        
        let totalUnidadesNoEndereco = 0;
        let htmlItens = "";
        let buscaTexto = `${e.rua} ${e.modulo} ${e.nivel} `.toLowerCase();

        vols.forEach(v => {
            const prod = dbState.produtos[v.produtoId] || { nome: "???", codigo: "S/C" };
            const forn = dbState.fornecedores[prod.fornecedorId] || { nome: "S/F" };
            totalUnidadesNoEndereco += v.quantidade;
            buscaTexto += `${prod.nome} ${prod.codigo} ${forn.nome} ${v.descricao} ${v.codigo || ''} `.toLowerCase();

            htmlItens += `
                <div class="item-row" style="border-bottom: 1px solid #eee; padding: 6px 0;">
                    <div class="item-info">
                        <div style="font-size: 9px; color: var(--primary); font-weight: bold; text-transform: uppercase;">${forn.nome}</div>
                        <div style="font-size: 11px; font-weight: bold;">P: ${prod.codigo} - ${prod.nome}</div>
                        <div style="font-size: 10px; color: #555;">V: ${v.codigo || 'S/C'} - ${v.descricao}</div>
                        <div style="font-size: 11px; color: var(--success); font-weight: bold;">Qtd: ${v.quantidade}</div>
                    </div>
                    ${userRole !== 'leitor' ? `
                        <div style="display:flex; gap:4px; align-items:center;">
                            <button onclick="window.abrirAcao('${v.id}', 'mover')" class="btn-mini" style="background:var(--info)" title="Mover"><i class="fas fa-exchange-alt"></i></button>
                            <button onclick="window.abrirAcao('${v.id}', 'saida')" class="btn-mini" style="background:var(--danger)" title="Saída"><i class="fas fa-sign-out-alt"></i></button>
                        </div>
                    ` : ''}
                </div>
            `;
        });

        card.dataset.busca = buscaTexto;
        card.innerHTML = `
            <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
                RUA ${e.rua} - MOD ${e.modulo} - NIV ${e.nivel}
                ${userRole === 'admin' ? `<i class="fas fa-trash" onclick="window.deletarEndereco('${e.id}')" style="cursor:pointer; font-size:12px;"></i>` : ''}
            </div>
            <div class="card-body" style="padding:10px; max-height:200px; overflow-y:auto;">
                ${htmlItens || '<small style="color:#ccc">Vazio</small>'}
            </div>
            <div class="card-footer" style="background:#f8f9fa; font-weight:bold; font-size:11px; text-align:right; padding:4px 10px; border-top:1px solid #ddd;">
                Total no Local: ${totalUnidadesNoEndereco}
            </div>
        `;
        grid.appendChild(card);
    });
    window.filtrarEstoque();
}

window.abrirAcao = (volId, tipo) => {
    if(userRole === 'leitor') return;
    const vol = dbState.volumes.find(v => v.id === volId);
    if(!vol) return;

    const modal = document.getElementById("modalMaster");
    const body = document.getElementById("modalBody");
    const title = document.getElementById("modalTitle");
    
    body.innerHTML = `
        <div style="font-size:12px; background:#f0f7ff; padding:10px; border-radius:5px; margin-bottom:15px;">
            Item: <b>${vol.descricao}</b><br>Saldo Atual: <b>${vol.quantidade}</b>
        </div>
        <label>QUANTIDADE:</label>
        <input type="number" id="qtdAcao" value="${vol.quantidade}" min="1" max="${vol.quantidade}" style="width:100%; margin-bottom:15px; padding:8px;">
    `;

    if (tipo === 'guardar' || tipo === 'mover') {
        title.innerText = tipo === 'guardar' ? "Endereçar Volume" : "Mover Volume";
        let opts = dbState.enderecos.map(e => `<option value="${e.id}">RUA ${e.rua} - MOD ${e.modulo} - NIV ${e.nivel}</option>`).join('');
        body.innerHTML += `<label>ENDEREÇO DESTINO:</label><select id="selDestino" style="width:100%; padding:8px;">${opts}</select>`;
    } else {
        title.innerText = "Dar Saída";
    }

    modal.style.display = "flex";

    document.getElementById("btnConfirmar").onclick = async () => {
        const qtd = parseInt(document.getElementById("qtdAcao").value);
        if(isNaN(qtd) || qtd <= 0 || qtd > vol.quantidade) return alert("Quantidade inválida!");

        try {
            if (tipo === 'saida') {
                await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtd), ultimaMovimentacao: serverTimestamp() });
                await addDoc(collection(db, "movimentacoes"), { 
                    tipo: "SAÍDA", produto: vol.descricao, quantidade: qtd, usuario: usernameDB, data: serverTimestamp() 
                });
            } else {
                const destinoId = document.getElementById("selDestino").value;
                const endDestino = dbState.enderecos.find(e => e.id === destinoId);
                const localizacao = `R${endDestino.rua}-M${endDestino.modulo}-N${endDestino.nivel}`;

                // Lógica de aglutinação (Soma se o volume já existir no destino)
                const volExistente = dbState.volumes.find(v => 
                    v.enderecoId === destinoId && v.produtoId === vol.produtoId && v.codigo === vol.codigo
                );

                if (volExistente) {
                    await updateDoc(doc(db, "volumes", volExistente.id), { quantidade: increment(qtd), ultimaMovimentacao: serverTimestamp() });
                } else {
                    if (qtd === vol.quantidade) {
                        await updateDoc(doc(db, "volumes", volId), { enderecoId: destinoId, ultimaMovimentacao: serverTimestamp() });
                    } else {
                        await addDoc(collection(db, "volumes"), {
                            produtoId: vol.produtoId, descricao: vol.descricao, codigo: vol.codigo || "",
                            quantidade: qtd, enderecoId: destinoId, ultimaMovimentacao: serverTimestamp()
                        });
                    }
                }

                if (qtd < vol.quantidade) {
                    await updateDoc(doc(db, "volumes", volId), { quantidade: increment(-qtd) });
                } else if (volExistente && qtd === vol.quantidade) {
                    await deleteDoc(doc(db, "volumes", volId));
                }

                await addDoc(collection(db, "movimentacoes"), { 
                    tipo: tipo.toUpperCase() === 'GUARDAR' ? "ENTRADA" : "TRANSFERÊNCIA", 
                    produto: vol.descricao, quantidade: qtd, destino: localizacao, usuario: usernameDB, data: serverTimestamp() 
                });
            }
            window.fecharModal(); loadAll();
        } catch (err) { console.error(err); alert("Erro ao processar!"); }
    };
};

window.abrirNovoEndereco = () => {
    if(userRole !== 'admin') return;
    const modal = document.getElementById("modalMaster");
    const body = document.getElementById("modalBody");
    const title = document.getElementById("modalTitle");

    title.innerText = "Cadastrar Novo Endereço";
    body.innerHTML = `
        <label>RUA:</label><input type="text" id="addRua" style="width:100%; margin-bottom:10px; padding:8px;">
        <label>MÓDULO:</label><input type="number" id="addMod" style="width:100%; margin-bottom:10px; padding:8px;">
        <label>NÍVEL:</label><input type="number" id="addNiv" value="1" style="width:100%; padding:8px;">
    `;
    modal.style.display = "flex";

    document.getElementById("btnConfirmar").onclick = async () => {
        const rua = document.getElementById("addRua").value.trim().toUpperCase();
        const mod = document.getElementById("addMod").value.trim();
        const niv = document.getElementById("addNiv").value.trim();
        if(!rua || !mod) return alert("Preencha Rua e Módulo!");
        
        const existe = dbState.enderecos.find(e => e.rua === rua && e.modulo === mod && e.nivel === niv);
        if(existe) return alert("Endereço já cadastrado!");

        await addDoc(collection(db, "enderecos"), { rua, modulo: mod, nivel: niv });
        window.fecharModal(); loadAll();
    };
};

window.deletarEndereco = async (id) => {
    if(userRole !== 'admin') return;
    if(confirm("Excluir endereço? Os itens voltarão para PENDENTES.")){
        try {
            const afetados = dbState.volumes.filter(v => v.enderecoId === id);
            for(let v of afetados) { 
                await updateDoc(doc(db, "volumes", v.id), { enderecoId: "" }); 
            }
            await deleteDoc(doc(db, "enderecos", id));
            loadAll();
        } catch(e) { console.error(e); alert("Erro ao excluir."); }
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

window.limparFiltros = () => {
    document.getElementById("filtroCod").value = "";
    document.getElementById("filtroForn").value = "";
    document.getElementById("filtroDesc").value = "";
    window.filtrarEstoque();
};

window.fecharModal = () => { document.getElementById("modalMaster").style.display = "none"; };
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
