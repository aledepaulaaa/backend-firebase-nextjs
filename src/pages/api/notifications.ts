// pages/api/notifications.ts

import { runCorsMiddleware } from '@/lib/cors';
import { firestoreDb } from '@/lib/firebaseAdmin';
import type { NextApiRequest, NextApiResponse } from 'next';
import admin from 'firebase-admin';

// Interface para o objeto de token que será armazenado no Firestore
interface TokenData {
    deviceId: string;
    fcmToken: string;
    createdAt: admin.firestore.Timestamp | Date;
    updatedAt: admin.firestore.Timestamp | Date;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Garante que o CORS seja aplicado
    await runCorsMiddleware(req, res);

    switch (req.method) {
        case 'GET':
            return await checkUserToken(req, res);
        case 'POST':
            // O método POST agora lida com registro e remoção de tokens
            return await handleTokenRegistration(req, res);
        default:
            res.setHeader('Allow', ['GET', 'POST']);
            return res.status(405).end(`Método ${req.method} Não Permitido`);
    }
}

/**
 * Verifica se um usuário/dispositivo já possui um token válido.
 * Chamado pelo frontend para verificar o estado inicial.
 */
async function checkUserToken(req: NextApiRequest, res: NextApiResponse) {
    const { email, deviceId } = req.query;

    if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'Email é obrigatório.' });
    }

    const emailLimpo = email.replace(/["']/g, '').trim().toLowerCase();
    const userDocRef = firestoreDb.collection('token-usuarios').doc(emailLimpo);
    const doc = await userDocRef.get();

    if (!doc.exists) {
        return res.status(200).json({ hasValidToken: false });
    }

    const tokens: TokenData[] = doc.data()?.fcmTokens || [];

    if (deviceId && typeof deviceId === 'string') {
        const deviceToken = tokens.find((t) => t.deviceId === deviceId);
        return res.status(200).json({ hasValidToken: !!deviceToken, token: deviceToken?.fcmToken });
    }

    // Se não houver deviceId, retorna o status geral e o primeiro token encontrado
    return res.status(200).json({ hasValidToken: tokens.length > 0, token: tokens[0]?.fcmToken });
}

/**
 * Lida com o registro (adição/atualização) e a remoção de tokens.
 * A ação é determinada pelo campo 'action' no corpo da requisição.
 */
async function handleTokenRegistration(req: NextApiRequest, res: NextApiResponse) {
    const { fcmToken, email, deviceId = 'default', action } = req.body;

    // Validação de Email
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Email válido é obrigatório.' });
    }

    const emailLimpo = email.replace(/["']/g, '').trim().toLowerCase();
    const userDocRef = firestoreDb.collection('token-usuarios').doc(emailLimpo);

    // --- LÓGICA DE REMOÇÃO (UNREGISTER) ---
    if (action === 'unregister') {
        if (!fcmToken) {
            return res.status(400).json({ error: 'fcmToken é obrigatório para a ação de remoção.' });
        }

        console.log(`Removendo token para o deviceId: ${deviceId} do usuário: ${emailLimpo}`);
        const userDoc = await userDocRef.get();
        if (!userDoc.exists) {
            return res.status(200).json({ success: true, message: 'Usuário não encontrado, nada a remover.' });
        }

        const tokens: TokenData[] = userDoc.data()?.fcmTokens || [];
        // Filtra mantendo todos os tokens EXCETO o que corresponde ao fcmToken a ser removido
        const updatedTokens = tokens.filter(t => t.fcmToken !== fcmToken);

        await userDocRef.update({ fcmTokens: updatedTokens });
        return res.status(200).json({ success: true, message: 'Token removido.' });
    }

    // --- LÓGICA DE REGISTRO (ADD/UPDATE) ---
    if (!fcmToken) {
        return res.status(400).json({ error: 'fcmToken é obrigatório para registrar.' });
    }

    console.log(`Registrando/Atualizando token para o deviceId: ${deviceId} do usuário: ${emailLimpo}`);
    const userDoc = await userDocRef.get();
    const now = new Date();

    if (!userDoc.exists) {
        // Se o documento do usuário não existe, cria um novo com o primeiro token.
        const newToken: TokenData = { deviceId, fcmToken, createdAt: now, updatedAt: now };
        await userDocRef.set({ fcmTokens: [newToken] });
    } else {
        // Se o documento já existe, atualiza o array de tokens.
        const tokens: TokenData[] = userDoc.data()?.fcmTokens || [];
        const tokenIndex = tokens.findIndex((t) => t.deviceId === deviceId);

        if (tokenIndex > -1) {
            // Se já existe um token para este deviceId, atualiza o fcmToken e a data de atualização.
            tokens[tokenIndex].fcmToken = fcmToken;
            tokens[tokenIndex].updatedAt = now;
        } else {
            // Se não existe, adiciona o novo token ao array.
            tokens.push({ deviceId, fcmToken, createdAt: now, updatedAt: now });
        }
        await userDocRef.update({ fcmTokens: tokens });
    }

    return res.status(200).json({ success: true, message: 'Token registrado/atualizado.' });
}