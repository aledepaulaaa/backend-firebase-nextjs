// src/pages/api/send-notification.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { firestoreDb, messaging } from '../../lib/firebaseAdmin'; // Ajuste o caminho
import * as admin from 'firebase-admin'; // Para tipagem da notificação

// Interface para a notificação esperada no corpo da requisição
interface NotificationPayload {
    title: string;
    body: string;
    // Adicione outros campos opcionais da notificação do FCM se precisar
    // imageUrl?: string;
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    const { email, token, notification } = req.body as {
        email?: string;
        token?: string;
        notification?: NotificationPayload
    };

    // Valida a notificação
    if (!notification || typeof notification !== 'object' || !notification.title || !notification.body) {
        return res.status(400).json({ error: "Formato de 'notification' inválido. Requer 'title' e 'body'." });
    }

    // Valida o target (email ou token)
    if (!email && !token) {
        return res.status(400).json({ error: "É necessário fornecer 'email' ou 'token' no body." });
    }
    if (email && typeof email !== 'string') {
        return res.status(400).json({ error: "'email' fornecido mas inválido." });
    }
    if (token && typeof token !== 'string') {
        return res.status(400).json({ error: "'token' fornecido mas inválido." });
    }
    if (email && token) {
        // Decide qual usar ou retorna erro - aqui vamos priorizar email se ambos forem fornecidos
        console.warn("[Send Notify] 'email' e 'token' fornecidos. Usando 'email'.");
    }


    let targetTokens: string[] = [];
    let targetDescription = ""; // Para logs

    try {
        if (email) { // Prioriza email se ambos fornecidos
            targetDescription = `email ${email}`;
            console.log(`[Send Notify] Buscando tokens para email: ${email}`);
            const userDocRef = firestoreDb.collection('token-usuarios').doc(email);
            const docSnap = await userDocRef.get();
            targetTokens = docSnap.exists ? (docSnap.data()?.fcmTokens || []) : [];

            if (targetTokens.length === 0) {
                console.log(`[Send Notify] Nenhum token encontrado para o email ${email}.`);
                return res.status(404).json({ error: `Nenhum token encontrado para o email ${email}.` });
            }
        } else if (token) {
            targetDescription = `token direto ${token.substring(0, 10)}...`;
            console.log(`[Send Notify] Enviando para token direto: ${targetDescription}`);
            targetTokens = [token];
        }
        // O caso de nenhum dos dois já foi tratado na validação inicial

        if (targetTokens.length === 0) {
            // Segurança extra, caso a lógica acima falhe
            console.error("[Send Notify] Lista de targetTokens está vazia inesperadamente.");
            return res.status(500).json({ error: "Não foi possível determinar os tokens de destino." });
        }


        // Monta a mensagem para o FCM
        const message: admin.messaging.MulticastMessage = {
            notification: notification, // Usa o objeto notification recebido
            tokens: targetTokens,
            // Opcional: Adicione outras configurações como data payload, ttl, priority aqui se necessário
            // data: { customKey: 'customValue' },
            // android: { priority: 'high' },
        };

        console.log(`[Send Notify] Enviando para ${targetTokens.length} tokens para ${targetDescription}...`);
        const response = await messaging.sendEachForMulticast(message);
        console.log(`[Send Notify] Resultado: ${response.successCount} sucessos, ${response.failureCount} falhas.`);

        // Opcional: Implementar limpeza de token inválido aqui também, se desejar, similar à rota traccar-event

        if (response.successCount > 0) {
            return res.status(200).json({
                success: true,
                message: `Enviado com sucesso para ${response.successCount} de ${targetTokens.length} tokens. Falhas: ${response.failureCount}.`,
                results: response.responses.map((r, i) => ({ // Retorna um resumo dos resultados
                    token: targetTokens[i].substring(0, 10) + '...', // Não expor token completo
                    success: r.success,
                    messageId: r.messageId,
                    error: r.error ? { code: r.error.code, message: r.error.message } : undefined
                }))
            });
        } else {
            console.error("[Send Notify] Falha ao enviar para TODOS os tokens.", response.responses.map(r => r.error));
            return res.status(500).json({
                error: "Falha ao enviar notificação para todos os tokens de destino.",
                details: response.responses.map((r, i) => ({ // Detalhes das falhas
                    token: targetTokens[i].substring(0, 10) + '...',
                    error: r.error ? { code: r.error.code, message: r.error.message } : 'Unknown error'
                }))
            });
        }
    } catch (error: any) { // Captura erros gerais (ex: Firestore indisponível)
        console.error(`[Send Notify] Erro GERAL ao enviar para ${targetDescription}:`, error);
        return res.status(500).json({ error: "Erro interno do servidor ao processar envio de notificação.", details: error.message });
    }
}