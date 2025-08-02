import type { NextApiRequest, NextApiResponse } from 'next'
import { firestoreDb } from '@/lib/firebaseAdmin'
import admin from 'firebase-admin'
import { runCorsMiddleware } from '@/lib/cors'

interface EventNotificationPayload {
    id: number
    attributes?: Record<string, any>
    deviceId: number
    name: string
    type: string
    eventTime: string
    positionId?: number
    geofenceId?: number
    maintenanceId?: number
}

interface TraccarEventRequest {
    email: string
    event: EventNotificationPayload
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    await runCorsMiddleware(req, res)

    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST'])
        return res.status(405).json({ error: `Metódo ${req.method} Não Permitido` })
    }

    const { email, event } = req.body as TraccarEventRequest
    console.log({
        "Email: ": email,
        "Evento: ": event
    })

    // função para limpar o email antes de usa-lo para verificar no Firestore
    function limparEmail(email: string): string {
        return email?.replace(/"/g, '').trim().toLowerCase() || ''
    }


    // Validações básicas
    if (!email) {
        return res.status(400).json({ error: 'Email é obrigatório.' })
    }

    if (!event || !event.deviceId || !event.type) {
        return res.status(400).json({ error: 'Dados de evento inválidos.' })
    }


    try {
        // Obter tokens registrados
        const emailLimpo = limparEmail(email)
        const userDocRef = firestoreDb.collection('token-usuarios').doc(emailLimpo)
        const userDoc = await userDocRef.get()

        if (!userDoc.exists) {
            return res.status(404).json({ error: `Nenhum registro de token para ${email}.` })
        }

        const tokens: string[] = userDoc.data()?.fcmTokens?.map((t: any) => t.fcmToken) || []
        if (tokens.length === 0) {
            return res.status(404).json({ error: 'Nenhum token disponível para envio.' })
        }

        const makeNotification = (() => {
            const base = event.name || `Dispositivo ${event.deviceId}`
            switch (event.type) {
                case 'deviceOnline': return { title: 'Dispositivo Online', body: `${base} está online` }
                case 'deviceOffline': return { title: 'Dispositivo Offline', body: `${base} está offline` }
                case 'deviceMoving': return { title: 'Movimento Detectado', body: `${base} está se movendo` }
                case 'deviceStopped': return { title: 'Dispositivo Parado', body: `${base} está parado` }
                case 'ignitionOn': return { title: 'Ignição Ligada', body: `${base}: ignição ligada` }
                case 'ignitionOff': return { title: 'Ignição Desligada', body: `${base}: ignição desligada` }
                case 'geofenceEnter': return { title: 'Cerca Virtual', body: `${base} entrou em ${event.attributes?.geofenceName || ''}` }
                case 'geofenceExit': return { title: 'Cerca Virtual', body: `${base} saiu de ${event.attributes?.geofenceName || ''}` }
                case 'alarm': return { title: 'Alarme', body: `${base}: ${event.attributes?.alarm || 'Alarme ativado'}` }
                default: return { title: 'Notificação', body: `${base}: ${event.type}` }
            }
        })()
        // console.log("Payload da notificação criado: ", makeNotification)

        // Payload FCM
        const message: admin.messaging.MulticastMessage = {
            tokens,
            notification: makeNotification,
            data: {
                name: String(event.name),
                type: event.type,
                eventTime: event.eventTime,
            },
            android: {
                priority: 'high',
                notification: { channelId: 'high_importance_channel', clickAction: 'FLUTTER_NOTIFICATION_CLICK' }
            },
            apns: { payload: { aps: { sound: 'default', badge: 1 } }, headers: { 'apns-priority': '10' } },
            webpush: {
                fcmOptions: { link: `/device/${event.deviceId}` },
                notification: { icon: '/icon-192x192.png', badge: '/icon-64x64.png', vibrate: [200, 100, 200] }
            }
        }

        console.log("Mensagem FCM construída:", message)

        console.log("Enviando notificações FCM...")
        // Envio e tratamento de respostas
        const batch = admin.messaging().sendEachForMulticast(message)
        const response = await batch
        console.log("Resposta do envio FCM:", response)

        // Filtrar tokens inválidos
        const invalid: string[] = []
        response.responses.forEach((r, i) => {
            if (!r.success && ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(r.error?.code || '')) {
                invalid.push(tokens[i])
            }
        })
        if (invalid.length) {
            console.log("Tokens inválidos encontrados:", invalid)
            await userDocRef.update({
                fcmTokens: admin.firestore.FieldValue.arrayRemove(...invalid.map(token => ({ fcmToken: token })))
            })
            console.log("Tokens inválidos removidos do Firestore.")
        }

        return res.status(200).json({
            success: true,
            sent: response.successCount,
            failed: response.failureCount,
            invalidRemoved: invalid.length,
            message: 'Notificações enviadas com sucesso.'
        })

    } catch (err: any) {
        console.error('[traccar-event] erro', err)
        return res.status(500).json({ error: 'Erro interno ao processar evento.' })
    }
}

// pages/api/traccar-event.ts

// import type { NextApiRequest, NextApiResponse } from 'next';
// import { firestoreDb } from '@/lib/firebaseAdmin';
// import admin from 'firebase-admin';
// import { runCorsMiddleware } from '@/lib/cors';

// // Interfaces (sem alteração)
// interface EventNotificationPayload {
//     id: number;
//     attributes?: Record<string, any>;
//     deviceId: number;
//     name: string;
//     type: string;
//     eventTime: string;
//     positionId?: number;
//     geofenceId?: number;
//     maintenanceId?: number;
// }

// interface TokenData {
//     deviceId: string;
//     fcmToken: string;
//     createdAt: admin.firestore.Timestamp | Date;
//     updatedAt: admin.firestore.Timestamp | Date;
// }

// export default async function handler(req: NextApiRequest, res: NextApiResponse) {
//     await runCorsMiddleware(req, res);

//     if (req.method !== 'POST') {
//         res.setHeader('Allow', ['POST']);
//         return res.status(405).json({ error: `Método ${req.method} Não Permitido` });
//     }

//     // --- MUDANÇA PRINCIPAL AQUI ---
//     // 1. O email agora vem da query string da URL.
//     const { email } = req.query;
//     // 2. O evento é o corpo inteiro da requisição.
//     const event = req.body as EventNotificationPayload;

//     // Função para limpar o email (sem alteração)
//     function limparEmail(email: string): string {
//         return email?.replace(/"/g, '').trim().toLowerCase() || '';
//     }

//     // Validações de entrada ajustadas
//     if (!email || typeof email !== 'string') {
//         return res.status(400).json({ error: 'Parâmetro de busca "email" é obrigatório.' });
//     }
//     if (!event || !event.deviceId || !event.type) {
//         return res.status(400).json({ error: 'Corpo da requisição com dados de evento inválido.' });
//     }

//     // O bloco try/catch agora será executado
//     try {
//         console.log(`Evento recebido para o email: ${email}`);
//         console.log(`Dados do evento:`, event);

//         const emailLimpo = limparEmail(email);
//         const userDocRef = firestoreDb.collection('token-usuarios').doc(emailLimpo);
//         const userDoc = await userDocRef.get();

//         if (!userDoc.exists) {
//             console.log(`Nenhum registro de token encontrado para ${emailLimpo}.`);
//             return res.status(404).json({ error: `Nenhum registro de token para ${emailLimpo}.` });
//         }

//         const allTokenObjects: TokenData[] = userDoc.data()?.fcmTokens || [];
//         if (allTokenObjects.length === 0) {
//             console.log(`Nenhum token FCM disponível para ${emailLimpo}.`);
//             return res.status(404).json({ error: 'Nenhum token disponível para envio.' });
//         }

//         const tokensToSend = allTokenObjects.map((t) => t.fcmToken);
//         console.log(`Enviando para ${tokensToSend.length} token(s).`);

//         // Lógica para criar a notificação (sem alteração)
//         const makeNotification = (() => {
//             const base = event.name || `Dispositivo ${event.deviceId}`;
//             switch (event.type) {
//                 case 'deviceOnline': return { title: 'Dispositivo Online', body: `${base} está online` };
//                 case 'deviceOffline': return { title: 'Dispositivo Offline', body: `${base} está offline` };
//                 case 'deviceMoving': return { title: 'Movimento Detectado', body: `${base} está se movendo` };
//                 case 'deviceStopped': return { title: 'Dispositivo Parado', body: `${base} está parado` };
//                 case 'ignitionOn': return { title: 'Ignição Ligada', body: `${base}: ignição ligada` };
//                 case 'ignitionOff': return { title: 'Ignição Desligada', body: `${base}: ignição desligada` };
//                 case 'geofenceEnter': return { title: 'Cerca Virtual', body: `${base} entrou em ${event.attributes?.geofenceName || 'uma cerca'}` };
//                 case 'geofenceExit': return { title: 'Cerca Virtual', body: `${base} saiu de ${event.attributes?.geofenceName || 'uma cerca'}` };
//                 case 'alarm': return { title: 'Alarme', body: `${base}: ${event.attributes?.alarm || 'Alarme ativado'}` };
//                 default: return { title: 'Notificação do Traccar', body: `${base}: ${event.type}` };
//             }
//         })();

//         const message: admin.messaging.MulticastMessage = {
//             tokens: tokensToSend,
//             notification: makeNotification,
//             data: { name: String(event.name), type: event.type, eventTime: event.eventTime },
//             android: { priority: 'high', notification: { channelId: 'high_importance_channel' } },
//             apns: { payload: { aps: { sound: 'default', badge: 1 } }, headers: { 'apns-priority': '10' } },
//             webpush: {
//                 fcmOptions: { link: `/device/${event.deviceId}` },
//                 notification: { icon: '/icon-192x192.png', badge: '/icon-64x64.png', vibrate: [200, 100, 200] }
//             }
//         };

//         const response = await admin.messaging().sendEachForMulticast(message);
//         console.log(`Sucesso: ${response.successCount}, Falhas: ${response.failureCount}`);

//         // Lógica de remoção de tokens inválidos (sem alteração, continua correta)
//         if (response.failureCount > 0) {
//             const invalidTokens = new Set<string>();
//             response.responses.forEach((resp, idx) => {
//                 if (!resp.success) {
//                     const errorCode = resp.error?.code;
//                     if (errorCode === 'messaging/invalid-registration-token' || errorCode === 'messaging/registration-token-not-registered') {
//                         const failedToken = tokensToSend[idx];
//                         console.log(`Token inválido detectado para remoção: ${failedToken}`);
//                         invalidTokens.add(failedToken);
//                     }
//                 }
//             });

//             if (invalidTokens.size > 0) {
//                 const validTokenObjects = allTokenObjects.filter((t) => !invalidTokens.has(t.fcmToken));
//                 await userDocRef.update({ fcmTokens: validTokenObjects });
//                 console.log(`${invalidTokens.size} tokens inválidos removidos do Firestore.`);
//             }
//         }

//         return res.status(200).json({
//             success: true,
//             sent: response.successCount,
//             failed: response.failureCount,
//             message: 'Notificações processadas.'
//         });

//     } catch (err: any) {
//         console.error('[traccar-event] Erro fatal no bloco try/catch:', err);
//         return res.status(500).json({ error: 'Erro interno ao processar evento.', details: err.message });
//     }
// }