import { runCorsMiddleware } from '@/lib/cors'
import { firestoreDb } from '@/lib/firebaseAdmin'
import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    await runCorsMiddleware(req, res)
    switch (req.method) {
        case 'GET': return checkUserToken(req, res)
        case 'POST': return registerToken(req, res)
        case 'DELETE': return deleteToken(req, res)
        default:
            res.setHeader('Allow', ['GET', 'POST', 'DELETE'])
            return res.status(405).end(`Metódo ${req.method} Não Permitido`)
    }
}

async function checkUserToken(req: NextApiRequest, res: NextApiResponse) {
    const { email, deviceId } = req.query

    if (!email) return res.status(400).json({ error: 'Email é obrigatório' })
    const ref = firestoreDb.collection('token-usuarios').doc(email as string)
    const doc = await ref.get()
    if (!doc.exists) return res.status(200).json({ hasValidToken: false })
    const tokens = doc.data()?.fcmTokens || []
    if (deviceId) {
        const dev = tokens.find((t: any) => t.deviceId === deviceId)
        return res.status(200).json({ hasValidToken: !!dev, token: dev?.fcmToken })
    }
    return res.status(200).json({ hasValidToken: tokens.length > 0, token: tokens[0]?.fcmToken })
}

async function registerToken(req: NextApiRequest, res: NextApiResponse) {
    const { fcmToken, email, deviceId = 'default' } = req.body

    console.log({
        "FCM Token: ": fcmToken,
        "Email: ": email,
        "Device ID: ": deviceId,
    })

    function validarEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        return emailRegex.test(email)
    }

    if (!fcmToken || !email || !validarEmail(email)) return res.status(400).json({ error: 'Token e email são obrigatórios' })


    function limparEmail(email: string): string {
        // Remove aspas e espaços em branco
        return email.replace(/["']/g, '').trim().toLowerCase()
    }

    const emailLimpo = limparEmail(email)
    const ref = firestoreDb.collection('token-usuarios').doc(emailLimpo)
    const doc = await ref.get()
    let tokens = doc.exists ? doc.data()?.fcmTokens || [] : []

    // Se token já existe igual, retorna sem atualizar
    const existing = tokens.find((t: any) => t.deviceId === deviceId && t.fcmToken === fcmToken)
    if (existing) return res.status(200).json({ success: true })

    const now = new Date()
    if (doc.exists) {
        const idx = tokens.findIndex((t: any) => t.deviceId === deviceId)
        if (idx >= 0) tokens[idx] = { deviceId, fcmToken, createdAt: tokens[idx].createdAt, updatedAt: now }
        else tokens.push({ deviceId, fcmToken, createdAt: now })
        await ref.update({ fcmTokens: tokens })
    } else {
        await ref.set({ fcmTokens: [{ deviceId, fcmToken, createdAt: now }] })
    }

    return res.status(200).json({ success: true })
}

async function deleteToken(req: NextApiRequest, res: NextApiResponse) {
    const { email, deviceId, fcmToken } = req.body
    if (!email) return res.status(400).json({ error: 'Email é obrigatório' })

    const ref = firestoreDb.collection('token-usuarios').doc(email)
    const doc = await ref.get()
    if (!doc.exists) return res.status(200).json({ success: true })

    let tokens = doc.data()?.fcmTokens || []
    if (deviceId) tokens = tokens.filter((t: any) => t.deviceId !== deviceId)
    else if (fcmToken) tokens = tokens.filter((t: any) => t.fcmToken !== fcmToken)
    else return res.status(400).json({ error: 'Token ou deviceId necessário' })

    await ref.update({ fcmTokens: tokens })
    return res.status(200).json({ success: true })
}


// pages/api/notifications.ts

// import { runCorsMiddleware } from '@/lib/cors';
// import { firestoreDb } from '@/lib/firebaseAdmin';
// import type { NextApiRequest, NextApiResponse } from 'next';
// import admin from 'firebase-admin';

// // Interface para o objeto de token que será armazenado no Firestore
// interface TokenData {
//     deviceId: string;
//     fcmToken: string;
//     createdAt: admin.firestore.Timestamp | Date;
//     updatedAt: admin.firestore.Timestamp | Date;
// }

// export default async function handler(req: NextApiRequest, res: NextApiResponse) {
//     // Garante que o CORS seja aplicado
//     await runCorsMiddleware(req, res);

//     switch (req.method) {
//         case 'GET':
//             return await checkUserToken(req, res);
//         case 'POST':
//             // O método POST agora lida com registro e remoção de tokens
//             return await handleTokenRegistration(req, res);
//         default:
//             res.setHeader('Allow', ['GET', 'POST']);
//             return res.status(405).end(`Método ${req.method} Não Permitido`);
//     }
// }

// /**
//  * Verifica se um usuário/dispositivo já possui um token válido.
//  * Chamado pelo frontend para verificar o estado inicial.
//  */
// async function checkUserToken(req: NextApiRequest, res: NextApiResponse) {
//     const { email, deviceId } = req.query;

//     if (!email || typeof email !== 'string') {
//         return res.status(400).json({ error: 'Email é obrigatório.' });
//     }

//     const emailLimpo = email.replace(/["']/g, '').trim().toLowerCase();
//     const userDocRef = firestoreDb.collection('token-usuarios').doc(emailLimpo);
//     const doc = await userDocRef.get();

//     if (!doc.exists) {
//         return res.status(200).json({ hasValidToken: false });
//     }

//     const tokens: TokenData[] = doc.data()?.fcmTokens || [];

//     if (deviceId && typeof deviceId === 'string') {
//         const deviceToken = tokens.find((t) => t.deviceId === deviceId);
//         return res.status(200).json({ hasValidToken: !!deviceToken, token: deviceToken?.fcmToken });
//     }

//     // Se não houver deviceId, retorna o status geral e o primeiro token encontrado
//     return res.status(200).json({ hasValidToken: tokens.length > 0, token: tokens[0]?.fcmToken });
// }

// /**
//  * Lida com o registro (adição/atualização) e a remoção de tokens.
//  * A ação é determinada pelo campo 'action' no corpo da requisição.
//  */
// async function handleTokenRegistration(req: NextApiRequest, res: NextApiResponse) {
//     const { fcmToken, email, deviceId = 'default', action } = req.body;

//     // Validação de Email
//     if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
//         return res.status(400).json({ error: 'Email válido é obrigatório.' });
//     }

//     const emailLimpo = email.replace(/["']/g, '').trim().toLowerCase();
//     const userDocRef = firestoreDb.collection('token-usuarios').doc(emailLimpo);

//     // --- LÓGICA DE REMOÇÃO (UNREGISTER) ---
//     if (action === 'unregister') {
//         if (!fcmToken) {
//             return res.status(400).json({ error: 'fcmToken é obrigatório para a ação de remoção.' });
//         }

//         console.log(`Removendo token para o deviceId: ${deviceId} do usuário: ${emailLimpo}`);
//         const userDoc = await userDocRef.get();
//         if (!userDoc.exists) {
//             return res.status(200).json({ success: true, message: 'Usuário não encontrado, nada a remover.' });
//         }

//         const tokens: TokenData[] = userDoc.data()?.fcmTokens || [];
//         // Filtra mantendo todos os tokens EXCETO o que corresponde ao fcmToken a ser removido
//         const updatedTokens = tokens.filter(t => t.fcmToken !== fcmToken);

//         await userDocRef.update({ fcmTokens: updatedTokens });
//         return res.status(200).json({ success: true, message: 'Token removido.' });
//     }

//     // --- LÓGICA DE REGISTRO (ADD/UPDATE) ---
//     if (!fcmToken) {
//         return res.status(400).json({ error: 'fcmToken é obrigatório para registrar.' });
//     }

//     console.log(`Registrando/Atualizando token para o deviceId: ${deviceId} do usuário: ${emailLimpo}`);
//     const userDoc = await userDocRef.get();
//     const now = new Date();

//     if (!userDoc.exists) {
//         // Se o documento do usuário não existe, cria um novo com o primeiro token.
//         const newToken: TokenData = { deviceId, fcmToken, createdAt: now, updatedAt: now };
//         await userDocRef.set({ fcmTokens: [newToken] });
//     } else {
//         // Se o documento já existe, atualiza o array de tokens.
//         const tokens: TokenData[] = userDoc.data()?.fcmTokens || [];
//         const tokenIndex = tokens.findIndex((t) => t.deviceId === deviceId);

//         if (tokenIndex > -1) {
//             // Se já existe um token para este deviceId, atualiza o fcmToken e a data de atualização.
//             tokens[tokenIndex].fcmToken = fcmToken;
//             tokens[tokenIndex].updatedAt = now;
//         } else {
//             // Se não existe, adiciona o novo token ao array.
//             tokens.push({ deviceId, fcmToken, createdAt: now, updatedAt: now });
//         }
//         await userDocRef.update({ fcmTokens: tokens });
//     }

//     return res.status(200).json({ success: true, message: 'Token registrado/atualizado.' });
// }