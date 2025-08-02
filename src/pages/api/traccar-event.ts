// pages/api/traccar-event.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import { firestoreDb } from '@/lib/firebaseAdmin';
import admin from 'firebase-admin';
import { runCorsMiddleware } from '@/lib/cors';

// Interfaces para tipagem dos dados recebidos
interface EventNotificationPayload {
    id: number;
    attributes?: Record<string, any>;
    deviceId: number;
    name: string;
    type: string;
    eventTime: string;
    positionId?: number;
    geofenceId?: number;
    maintenanceId?: number;
}

interface TraccarEventRequest {
    email: string;
    event: EventNotificationPayload;
}

interface TokenData {
    deviceId: string;
    fcmToken: string;
    createdAt: admin.firestore.Timestamp | Date;
    updatedAt: admin.firestore.Timestamp | Date;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    await runCorsMiddleware(req, res);

    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: `Método ${req.method} Não Permitido` });
    }

    const { email, event } = req.body as TraccarEventRequest;

    // Função para limpar o email antes de usá-lo
    function limparEmail(email: string): string {
        return email?.replace(/"/g, '').trim().toLowerCase() || '';
    }

    // Validações de entrada
    if (!email) {
        return res.status(400).json({ error: 'Email é obrigatório.' });
    }
    if (!event || !event.deviceId || !event.type) {
        return res.status(400).json({ error: 'Dados de evento inválidos.' });
    }

    try {
        const emailLimpo = limparEmail(email);
        const userDocRef = firestoreDb.collection('token-usuarios').doc(emailLimpo);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: `Nenhum registro de token para ${emailLimpo}.` });
        }

        const allTokenObjects: TokenData[] = userDoc.data()?.fcmTokens || [];
        if (allTokenObjects.length === 0) {
            return res.status(404).json({ error: 'Nenhum token disponível para envio.' });
        }

        // Extrai apenas a string do token para o envio
        const tokensToSend = allTokenObjects.map((t) => t.fcmToken);

        // Lógica para criar a mensagem da notificação (seu código original está ótimo)
        const makeNotification = (() => {
            const base = event.name || `Dispositivo ${event.deviceId}`;
            switch (event.type) {
                case 'deviceOnline': return { title: 'Dispositivo Online', body: `${base} está online` };
                case 'deviceOffline': return { title: 'Dispositivo Offline', body: `${base} está offline` };
                case 'deviceMoving': return { title: 'Movimento Detectado', body: `${base} está se movendo` };
                case 'deviceStopped': return { title: 'Dispositivo Parado', body: `${base} está parado` };
                case 'ignitionOn': return { title: 'Ignição Ligada', body: `${base}: ignição ligada` };
                case 'ignitionOff': return { title: 'Ignição Desligada', body: `${base}: ignição desligada` };
                case 'geofenceEnter': return { title: 'Cerca Virtual', body: `${base} entrou em ${event.attributes?.geofenceName || 'uma cerca'}` };
                case 'geofenceExit': return { title: 'Cerca Virtual', body: `${base} saiu de ${event.attributes?.geofenceName || 'uma cerca'}` };
                case 'alarm': return { title: 'Alarme', body: `${base}: ${event.attributes?.alarm || 'Alarme ativado'}` };
                default: return { title: 'Notificação do Traccar', body: `${base}: ${event.type}` };
            }
        })();

        // Monta o payload da mensagem para o FCM
        const message: admin.messaging.MulticastMessage = {
            tokens: tokensToSend,
            notification: makeNotification,
            data: {
                name: String(event.name),
                type: event.type,
                eventTime: event.eventTime,
            },
            android: { priority: 'high', notification: { channelId: 'high_importance_channel' } },
            apns: { payload: { aps: { sound: 'default', badge: 1 } }, headers: { 'apns-priority': '10' } },
            webpush: {
                fcmOptions: { link: `/device/${event.deviceId}` },
                notification: { icon: '/icon-192x192.png', badge: '/icon-64x64.png', vibrate: [200, 100, 200] }
            }
        };

        // Envia as notificações
        const response = await admin.messaging().sendEachForMulticast(message);

        // --- LÓGICA CORRIGIDA PARA REMOÇÃO DE TOKENS INVÁLIDOS ---
        if (response.failureCount > 0) {
            const invalidTokens = new Set<string>();
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    const errorCode = resp.error?.code;
                    // Verifica os códigos de erro que indicam um token inválido ou não registrado
                    if (errorCode === 'messaging/invalid-registration-token' ||
                        errorCode === 'messaging/registration-token-not-registered') {
                        const failedToken = tokensToSend[idx];
                        console.log(`Token inválido detectado: ${failedToken}`);
                        invalidTokens.add(failedToken);
                    }
                }
            });

            if (invalidTokens.size > 0) {
                console.log(`Removendo ${invalidTokens.size} tokens inválidos do Firestore...`);
                // Filtra o array original, mantendo apenas os objetos de token que NÃO SÃO inválidos
                const validTokenObjects = allTokenObjects.filter((t) => !invalidTokens.has(t.fcmToken));
                
                // Atualiza o documento no Firestore com o novo array de tokens válidos
                await userDocRef.update({ fcmTokens: validTokenObjects });
                console.log("Tokens inválidos removidos com sucesso.");
            }
        }
        // --- FIM DA LÓGICA DE REMOÇÃO ---

        return res.status(200).json({
            success: true,
            sent: response.successCount,
            failed: response.failureCount,
            invalidRemoved: response.failureCount, // Simplificado para refletir o total de falhas
            message: 'Notificações processadas.'
        });

    } catch (err: any) {
        console.error('[traccar-event] Erro fatal:', err);
        return res.status(500).json({ error: 'Erro interno ao processar evento.', details: err.message });
    }
}