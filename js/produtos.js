import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    collection, addDoc, getDocs, serverTimestamp, doc, getDoc,
    updateDoc, query, orderBy, deleteDoc, increment, where
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
        selC.innerHTML += opt; selF.innerHTML += opt;
    });
    refresh();
}

async function refresh() {
    const [pSnap, vSnap] = await Promise.all([
        getDocs(query(collection(db, "produtos"), orderBy("nome"))),
        getDocs(collection(db, "volumes"))
    ]);
    
    const tbody = document.getElementById("tblEstoque");
    tbody.innerHTML = "";

    const produtosMap = {};
    vSnap.forEach(d => {
        const v = d.data();
        const pId = v.produtoId;
        if(!produtosMap[pId]) produtosMap[pId] = {};
        
        const sku = v.codigo || "S/C";
        if(!produtosMap[pId][sku]) {
            produtosMap[pId][sku] = { 
                codigo: sku,
                descricao: v.descricao,
                quantidade: 0,
                possuiEnderecado: false 
            };
        }
        produtosMap[pId][sku].quantidade += (v.quantidade || 0);
        if(v.enderecoId && v.enderecoId !== "") {
            produtosMap[pId][sku].possuiEnderecado = true;
        }
    });

    pSnap.forEach(d => {
        const p = d.data();
        const pId = d.id;
        const volumesUnificados = Object.values(produtosMap[pId] || {});
        const totalGeral = volumesUnificados.reduce((acc, curr) => acc + curr.quantidade, 0);

        tbody.innerHTML += `
            <tr class="prod-row" data-id="${pId}" data-cod="${p.codigo}" data-forn="${p.fornecedorId}" onclick="window.toggleVols('${pId}')">
                <td style="text-align:center;"><i class="fas fa-chevron-right"></i></td>
                <td>${p.codigo || '---'}</td>
                <td style="color:var(--primary); font-size:12px;">${fornecedoresCache[p.fornecedorId] || "---"}</td>
                <td>${p.nome}</td>
                <td style="text-align:center;"><span class="badge-qty">${totalGeral}</span></td>
                <td style="text-align:right;">
                    <button class="btn btn-sm" style="background:var(--success); color:white;" onclick="event.stopPropagation(); window.modalNovoVolume('${pId}', '${p.nome}')"><i class="fas fa-plus"></i></button>
                </td>
            </tr>
        `;

        volumesUnificados.forEach(v => {
            tbody.innerHTML += `
                <tr class="child-row child-${pId}" data-sku="${v.codigo}">
                    <td></td>
                    <td style="font-size:11px; color:var(--gray);">SKU: ${v.codigo}</td>
                    <td colspan="2" style="padding-left:20px; color:#555;">${v.descricao}</td>
                    <td style="text-align:center; font-weight:bold;">${v.quantidade}</td>
                    <td style="text-align:right;">
                        <div style="display:flex; gap:5px; justify-content:flex-end;">
                            <button class="btn btn-sm" style="background:var(--info); color:white;" onclick="window.movimentar('${pId}','${v.codigo}','${p.nome}','${v.descricao}',${v.quantidade},'ENTRADA')" title="Entrada"><i class="fas fa-arrow-up"></i> ENTRADA</button>
                            <button class="btn btn-sm" style="background:var(--danger); color:white;" onclick="window.movimentar('${pId}','${v.codigo}','${p.nome}','${v.descricao}',${v.quantidade},'SAÍDA')" title="Saída"><i class="fas fa-arrow-down"></i> SAÍDA</button>
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

    // Buscar volumes deste produto com este SKU
    const q = query(collection(db, "volumes"), where("produtoId", "==", pId), where("codigo", "==", sku));
    const vSnap = await getDocs(q);
    
    let volSemEndereco = null;
    let jaTemEndereco = false;

    vSnap.forEach(docV => {
        const data = docV.data();
        if(!data.enderecoId || data.enderecoId === "") {
            volSemEndereco = { id: docV.id, ...data };
        } else {
            jaTemEndereco = true;
        }
    });

    if(tipo === 'ENTRADA') {
        // Na entrada, prioriza somar no que está "A Endereçar"
        if(volSemEndereco) {
            const novaQtd = volSemEndereco.quantidade + qtdInformada;
            await updateDoc(doc(db, "volumes", volSemEndereco.id), { quantidade: novaQtd });
            await registrarMov("ENTRADA", pNome, vDesc, qtdInformada, volSemEndereco.quantidade, novaQtd);
        } else {
            // Se não existe volume pendente, cria um novo "A Endereçar"
            await addDoc(collection(db, "volumes"), {
                produtoId: pId, codigo: sku, descricao: vDesc, 
                quantidade: qtdInformada, enderecoId: "", dataAlt: serverTimestamp()
            });
            await registrarMov("ENTRADA (NOVO)", pNome, vDesc, qtdInformada, 0, qtdInformada);
        }
        refresh();
    } else {
        // LÓGICA DE SAÍDA (A sua regra de trava)
        if(jaTemEndereco) {
            alert(`ERRO: O produto "${vDesc}" já possui unidades endereçadas!\n\nPara garantir a organização física, a saída deve ser feita diretamente pela tela de ENDEREÇAMENTO.`);
            return;
        }

        if(volSemEndereco) {
            if(volSemEndereco.quantidade < qtdInformada) return alert("Quantidade insuficiente no estoque pendente!");
            const novaQtd = volSemEndereco.quantidade - qtdInformada;
            
            if(novaQtd === 0) {
                await deleteDoc(doc(db, "volumes", volSemEndereco.id));
            } else {
                await updateDoc(doc(db, "volumes", volSemEndereco.id), { quantidade: novaQtd });
            }
            await registrarMov("SAÍDA", pNome, vDesc, qtdInformada, volSemEndereco.quantidade, novaQtd);
            refresh();
        } else {
            alert("Não há unidades 'A Endereçar' para este produto.");
        }
    }
};

// ... (Restante das funções: filtrar, toggleVols, modalNovoVolume permanecem iguais ao anterior) ...
