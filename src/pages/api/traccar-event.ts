// pages/api/traccar-event.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import { firestoreDb } from '@/lib/firebaseAdmin';
import admin from 'firebase-admin';
import { runCorsMiddleware } from '@/lib/cors';

// --- Interfaces para a estrutura completa do corpo recebido do Traccar ---
interface TraccarDevice {
    id: number;
    name: string;
    // Adicione outros campos do dispositivo se precisar deles
}

interface TraccarEvent {
    id: number;
    attributes?: Record<string, any>;
    deviceId: number;
    type: string;
    eventTime: string;
    // Adicione outros campos do evento se precisar deles
}

interface TraccarPayload {
    event: TraccarEvent;
    device: TraccarDevice;
    // O Traccar também pode enviar 'position', adicione se for útil
}

interface TokenData {
    fcmToken: string;
    // Outros campos como deviceId, createdAt, etc., podem estar aqui
}

/**
 * Função auxiliar para buscar o email do usuário no Traccar usando o deviceId.
 * Esta é a nova lógica central para encontrar o destinatário da notificação.
 */
async function getUserEmailFromTraccar(deviceId: number): Promise<string | null> {
    // Lê as credenciais da API do Traccar a partir das variáveis de ambiente
    const traccarUrl = process.env.TRACCAR_API_URL;
    const traccarEmail = process.env.TRACCAR_API_EMAIL;
    const traccarPassword = process.env.TRACCAR_API_PASSWORD;

    if (!traccarUrl || !traccarEmail || !traccarPassword) {
        console.error("ERRO: Variáveis de ambiente TRACCAR_API_URL, TRACCAR_API_EMAIL, ou TRACCAR_API_PASSWORD não estão configuradas na Vercel.");
        return null;
    }

    try {
        // A API do Traccar usa autenticação Basic. Codificamos as credenciais.
        const authHeader = 'Basic ' + Buffer.from(`${traccarEmail}:${traccarPassword}`).toString('base64');
        
        // Faz a chamada para o endpoint /api/users do Traccar, filtrando pelo deviceId
        const response = await fetch(`${traccarUrl}/api/users?deviceId=${deviceId}`, {
            headers: {
                'Authorization': authHeader,
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            console.error(`Erro ao buscar usuário no Traccar para deviceId ${deviceId}. Status: ${response.status}`);
            return null;
        }

        const users = await response.json();
        
        // A resposta é um array de usuários. O primeiro é geralmente o dono direto.
        if (users && users.length > 0 && users[0].email) {
            console.log(`Email encontrado para o deviceId ${deviceId}: ${users[0].email}`);
            return users[0].email;
        } else {
            console.warn(`Nenhum usuário com email encontrado para o deviceId ${deviceId}.`);
            return null;
        }
    } catch (error) {
        console.error("Erro de rede ao contatar a API do Traccar:", error);
        return null;
    }
}


export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    await runCorsMiddleware(req, res);

    if (req.method !== 'POST') {
        return res.status(405).json({ error: `Método ${req.method} Não Permitido` });
    }

    // O payload completo (evento, dispositivo, etc.) é o corpo da requisição
    const payload = req.body as TraccarPayload;
    const { event, device } = payload;

    // Validação básica para garantir que recebemos os dados essenciais do Traccar
    if (!event || !device || !event.deviceId) {
        return res.status(400).json({ error: 'Corpo da requisição inválido. Dados do evento ou dispositivo ausentes.' });
    }

    try {
        // 1. Obter o email do usuário fazendo uma chamada à API do Traccar
        const userEmail = await getUserEmailFromTraccar(event.deviceId);
        console.log("Email do usuário:", userEmail);

        if (!userEmail) {
            // Se não encontrarmos um email, não há como prosseguir.
            // Retornamos 200 OK para que o Traccar não tente reenviar este evento.
            console.log(`Processo encerrado para deviceId ${event.deviceId} pois não foi encontrado um usuário com email associado.`);
            return res.status(200).json({ success: true, message: "Evento recebido, mas nenhum usuário com email associado ao dispositivo." });
        }

        const emailLimpo = userEmail.trim().toLowerCase();
        console.log(`Processando evento '${event.type}' para o usuário: ${emailLimpo}`);

        // 2. Com o email em mãos, buscamos os tokens no Firestore
        const userDocRef = firestoreDb.collection('token-usuarios').doc(emailLimpo);
        const userDoc = await userDocRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({ error: `Nenhum registro de token encontrado no Firestore para ${emailLimpo}.` });
        }

        const allTokenObjects: TokenData[] = userDoc.data()?.fcmTokens || [];
        if (allTokenObjects.length === 0) {
            return res.status(404).json({ error: 'Nenhum token FCM disponível para envio.' });
        }

        const tokensToSend = allTokenObjects.map((t) => t.fcmToken);
        
        // Lógica para criar a mensagem da notificação
        const makeNotification = (() => {
            const base = device.name || `Dispositivo ${event.deviceId}`;
            switch (event.type) {
                case 'deviceOnline': return { title: 'Dispositivo Online', body: `${base} está online.` };
                case 'deviceOffline': return { title: 'Dispositivo Offline', body: `${base} está offline.` };
                case 'deviceMoving': return { title: 'Movimento Detectado', body: `${base} começou a se mover.` };
                case 'deviceStopped': return { title: 'Dispositivo Parado', body: `${base} parou.` };
                case 'ignitionOn': return { title: 'Ignição Ligada', body: `A ignição do ${base} foi ligada.` };
                case 'ignitionOff': return { title: 'Ignição Desligada', body: `A ignição do ${base} foi desligada.` };
                case 'geofenceEnter': return { title: 'Entrada em Cerca Virtual', body: `${base} entrou em ${event.attributes?.geofenceName || 'uma cerca'}.` };
                case 'geofenceExit': return { title: 'Saída de Cerca Virtual', body: `${base} saiu de ${event.attributes?.geofenceName || 'uma cerca'}.` };
                case 'alarm': return { title: `Alarme Disparado: ${event.attributes?.alarm || 'SOS'}`, body: `Alarme disparado no dispositivo ${base}.` };
                default: return { title: 'Notificação do Traccar', body: `${base}: ${event.type}` };
            }
        })();

        const message: admin.messaging.MulticastMessage = {
            tokens: tokensToSend,
            notification: makeNotification,
            data: { deviceId: String(device.id), eventType: event.type },
            android: { priority: 'high', notification: { channelId: 'high_importance_channel' } },
            apns: { payload: { aps: { sound: 'default', badge: 1 } }, headers: { 'apns-priority': '10' } },
            webpush: {
                fcmOptions: { link: `/device/${device.id}` },
                notification: { icon: '/icon-192x192.png', badge: '/icon-64x64.png', vibrate: [200, 100, 200] }
            }
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`Envio concluído para ${emailLimpo}. Sucesso: ${response.successCount}, Falhas: ${response.failureCount}`);

        // Lógica de remoção de tokens inválidos (sem alteração)
        if (response.failureCount > 0) {
            const invalidTokens = new Set<string>();
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    const errorCode = resp.error?.code;
                    if (errorCode === 'messaging/invalid-registration-token' || errorCode === 'messaging/registration-token-not-registered') {
                        const failedToken = tokensToSend[idx];
                        invalidTokens.add(failedToken);
                    }
                }
            });

            if (invalidTokens.size > 0) {
                console.log(`Removendo ${invalidTokens.size} tokens inválidos do Firestore...`);
                const validTokenObjects = allTokenObjects.filter((t) => !invalidTokens.has(t.fcmToken));
                await userDocRef.update({ fcmTokens: validTokenObjects });
            }
        }

        return res.status(200).json({ success: true, message: 'Notificações processadas.' });

    } catch (err: any) {
        console.error('[traccar-event] Erro fatal no bloco try/catch:', err);
        return res.status(500).json({ error: 'Erro interno ao processar evento.', details: err.message });
    }
}