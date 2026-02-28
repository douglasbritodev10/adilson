import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, serverTimestamp, doc, getDoc,
    updateDoc, query, orderBy, deleteDoc, where 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

let fornecedoresCache = {};
let userRole = "leitor";
let usernameDB = "Usuário";

onAuthStateChanged(auth, async user => {
    if (user) {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
            const data = userSnap.data();
            usernameDB = data.nomeCompleto || "Usuário";
            userRole = (data.role || "leitor").toLowerCase();
            if(userRole === "admin") document.getElementById("painelCadastro").style.display = "flex";
        }
        document.getElementById("userDisplay").innerHTML = `<i class="fas fa-user"></i> ${usernameDB}`;
        init();
    } else { window.location.href = "index.html"; }
});

async function registrarMov(tipo, prod, vol, qtd, ant, atu) {
    await addDoc(collection(db, "movimentacoes"), {
        usuario: usernameDB, tipo, produto: prod, volume: vol, 
        quantidade: qtd, anterior: ant, atual: atu, data: serverTimestamp()
    });
}

async function init() {
    const fSnap = await getDocs(query(collection(db, "fornecedores"), orderBy("nome")));
    const selC = document.getElementById("selForn");
    const selF = document.getElementById("filtroForn");
    selC.innerHTML = '<option value="">Escolha o Fornecedor</option>';
    selF.innerHTML = '<option value="">Todos os Fornecedores</option>';
    fSnap.forEach(d => {
        fornecedoresCache[d.id] = d.data().nome;
        const opt = `<option value="${d.id}">${d.data().nome}</option>`;
        if(selC) selC.innerHTML += opt; 
        if(selF) selF.innerHTML += opt;
    });
    refresh();
}

async function refresh() {
    const pSnap = await getDocs(query(collection(db, "produtos"), orderBy("nome")));
    const vSnap = await getDocs(collection(db, "volumes"));
    
    const tbody = document.getElementById("tblEstoque");
    tbody.innerHTML = "";

    // Mapeia volumes por produto
    const volumesPorProduto = {};
    vSnap.forEach(d => {
        const v = d.data();
        const pId = v.produtoId;
        if(!volumesPorProduto[pId]) volumesPorProduto[pId] = {};
        
        const sku = v.codigo || "S/C";
        if(!volumesPorProduto[pId][sku]) {
            volumesPorProduto[pId][sku] = { 
                codigo: sku,
                descricao: v.descricao,
                quantidade: 0,
                possuiEnderecado: false 
            };
        }
        volumesPorProduto[pId][sku].quantidade += (v.quantidade || 0);
        if(v.enderecoId) volumesPorProduto[pId][sku].possuiEnderecado = true;
    });

    pSnap.forEach(d => {
        const p = d.data();
        const pId = d.id;
        const volumesUnificados = Object.values(volumesPorProduto[pId] || {});
        const totalGeral = volumesUnificados.reduce((acc, curr) => acc + curr.quantidade, 0);

        // LINHA DO PRODUTO (Sempre aparece)
        tbody.innerHTML += `
            <tr class="prod-row" data-id="${pId}" data-cod="${p.codigo || ''}" data-forn="${p.fornecedorId}" onclick="window.toggleVols('${pId}')">
                <td style="text-align:center;"><i class="fas fa-chevron-right"></i></td>
                <td>${p.codigo || '---'}</td>
                <td style="color:var(--primary); font-size:12px;">${fornecedoresCache[p.fornecedorId] || "---"}</td>
                <td>${p.nome}</td>
                <td style="text-align:center;"><span class="badge-qty">${totalGeral}</span></td>
                <td style="text-align:right;">
                    <button class="btn btn-sm" style="background:var(--success); color:white;" onclick="event.stopPropagation(); window.modalNovoVolume('${pId}', '${p.nome}')" title="Novo Volume"><i class="fas fa-plus"></i></button>
                    ${userRole === 'admin' ? `<button class="btn btn-sm" style="background:var(--danger); color:white;" onclick="event.stopPropagation(); window.deletarProd('${pId}', '${p.nome}')"><i class="fas fa-trash"></i></button>` : ''}
                </td>
            </tr>
        `;

        // LINHAS DOS VOLUMES (Filhos unificados)
        volumesUnificados.forEach(v => {
            tbody.innerHTML += `
                <tr class="child-row child-${pId}" data-sku="${v.codigo}">
                    <td></td>
                    <td style="font-size:11px; color:var(--gray);">SKU: ${v.codigo}</td>
                    <td colspan="2" style="padding-left:20px; color:#555;">${v.descricao}</td>
                    <td style="text-align:center; font-weight:bold;">${v.quantidade}</td>
                    <td style="text-align:right;">
                        <div style="display:flex; gap:5px; justify-content:flex-end;">
                            <button class="btn btn-sm" style="background:var(--info); color:white;" onclick="window.movimentar('${pId}','${v.codigo}','${p.nome}','${v.descricao}',${v.quantidade},'ENTRADA')"><i class="fas fa-arrow-up"></i></button>
                            <button class="btn btn-sm" style="background:var(--danger); color:white;" onclick="window.movimentar('${pId}','${v.codigo}','${p.nome}','${v.descricao}',${v.quantidade},'SAÍDA')"><i class="fas fa-arrow-down"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        });
    });
}

window.movimentar = async (pId, sku, pNome, vDesc, qtdAtual, tipo) => {
    if(userRole === 'leitor') return;
    const val = prompt(`${tipo} - ${vDesc}\nQuantidade:`);
    if(!val || isNaN(val) || parseInt(val) <= 0) return;
    const qtdInformada = parseInt(val);

    const q = query(collection(db, "volumes"), where("produtoId", "==", pId), where("codigo", "==", sku));
    const vSnap = await getDocs(q);
    
    let volSemEndereco = null;
    let jaTemEndereco = false;

    vSnap.forEach(docV => {
        const data = docV.data();
        if(!data.enderecoId || data.enderecoId === "") volSemEndereco = { id: docV.id, ...data };
        else jaTemEndereco = true;
    });

    if(tipo === 'ENTRADA') {
        if(volSemEndereco) {
            await updateDoc(doc(db, "volumes", volSemEndereco.id), { quantidade: volSemEndereco.quantidade + qtdInformada });
        } else {
            await addDoc(collection(db, "volumes"), {
                produtoId: pId, codigo: sku, descricao: vDesc, 
                quantidade: qtdInformada, enderecoId: "", dataAlt: serverTimestamp()
            });
        }
        alert("Entrada registrada! O volume está na lista 'A Endereçar'.");
        refresh();
    } else {
        if(jaTemEndereco) {
            alert("PRODUTO JÁ ENDEREÇADO!\nA saída deve ser feita pela tela de ESTOQUE/ENDEREÇAMENTO.");
            return;
        }
        if(!volSemEndereco || volSemEndereco.quantidade < qtdInformada) {
            alert("Quantidade insuficiente nos volumes não endereçados.");
            return;
        }
        const novaQtd = volSemEndereco.quantidade - qtdInformada;
        if(novaQtd === 0) await deleteDoc(doc(db, "volumes", volSemEndereco.id));
        else await updateDoc(doc(db, "volumes", volSemEndereco.id), { quantidade: novaQtd });
        refresh();
    }
};

window.modalNovoVolume = (pId, pNome) => {
    document.getElementById("modalTitle").innerText = `Novo Volume: ${pNome}`;
    document.getElementById("modalBody").innerHTML = `
        <label>SKU (CÓDIGO DO VOLUME)</label><input type="text" id="vCod">
        <label>DESCRIÇÃO DO VOLUME</label><input type="text" id="vDesc" placeholder="Ex: CX 1/2 ou Tampo">
        <label>QTD INICIAL</label><input type="number" id="vQtd" value="1">
    `;
    document.getElementById("modalMaster").style.display = "flex";
    document.getElementById("btnModalConfirm").onclick = async () => {
        const cod = document.getElementById("vCod").value;
        const desc = document.getElementById("vDesc").value.toUpperCase();
        const qtd = parseInt(document.getElementById("vQtd").value);
        if(!cod || !desc) return alert("Preencha tudo!");
        
        await addDoc(collection(db, "volumes"), {
            produtoId: pId, codigo: cod, descricao: desc, 
            quantidade: qtd, enderecoId: "", dataAlt: serverTimestamp()
        });
        window.fecharModal(); refresh();
    };
};

window.toggleVols = (pId) => {
    document.querySelectorAll(`.child-${pId}`).forEach(r => r.classList.toggle('active'));
};

window.deletarProd = async (id, nome) => {
    if(confirm(`Excluir o produto "${nome}" e todos os seus volumes?`)) {
        await deleteDoc(doc(db, "produtos", id));
        refresh();
    }
};

document.getElementById("btnSaveProd").onclick = async () => {
    const n = document.getElementById("newNome").value.toUpperCase();
    const c = document.getElementById("newCod").value;
    const f = document.getElementById("selForn").value;
    if(!n || !f) return alert("Preencha Nome e Fornecedor!");
    await addDoc(collection(db, "produtos"), { nome: n, codigo: c, fornecedorId: f, dataCad: serverTimestamp() });
    document.getElementById("newNome").value = "";
    document.getElementById("newCod").value = "";
    refresh();
};

window.fecharModal = () => document.getElementById("modalMaster").style.display = "none";
window.logout = () => signOut(auth).then(() => window.location.href = "index.html");
window.limparFiltros = () => { location.reload(); };
