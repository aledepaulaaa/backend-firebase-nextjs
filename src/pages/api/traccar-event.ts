// src/pages/api/traccar-event.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import * as admin from 'firebase-admin'; // Para FieldValue e MessagingError
import { firestoreDb, messaging } from '@/lib/firebaseAdmin';

// --------------- !!!!!!!!!!!!!!! IMPORTANTE !!!!!!!!!!!!!!! ---------------
// ESTA FUNÇÃO É UM PLACEHOLDER. Você PRECISA implementar a lógica
// para encontrar o email do usuário associado ao device.userId do Traccar.
// Isso pode envolver:
// 1. Consultar a API do próprio Traccar (se ele tiver essa informação ou atributos customizados).
// 2. Consultar uma outra base de dados sua que faça essa ligação.
// 3. Assumir que o `device.contact` ou outro campo do Traccar *é* o email (verifique seus dados).
async function getUserEmailByTraccarUserId(userId: number | string): Promise<string | null> {
    console.log(`[Traccar Event - Placeholder] Tentando encontrar email para Traccar User ID: ${userId}`);

    // ----- EXEMPLO DE LÓGICA (SUBSTITUA PELA SUA REALIDADE) -----
    // Exemplo 1: Se o userId do Traccar for o próprio email (improvável)
    // if (typeof userId === 'string' && userId.includes('@')) {
    //   return userId;
    // }

    // Exemplo 2: Consultar uma API externa (ex: a do Traccar para pegar /users/{id} e ver o email)
    //              Requires 'node-fetch' or similar (npm install node-fetch)
    /*
    const fetch = (await import('node-fetch')).default; // Dynamic import for ES modules
    const traccarApiUrl = process.env.TRACCAR_USER_API_URL; // e.g., http://your-traccar:8082/api/users
    const traccarApiAuth = process.env.TRACCAR_API_AUTH; // e.g., Basic YWRtaW46YWRtaW4=

    if (!traccarApiUrl || !traccarApiAuth) {
        console.error("[Traccar Event] Variáveis de ambiente TRACCAR_USER_API_URL ou TRACCAR_API_AUTH não configuradas.");
        return null;
    }

    try {
        const response = await fetch(`${traccarApiUrl}/${userId}`, {
            headers: { 'Authorization': traccarApiAuth }
        });
        if (!response.ok) {
            console.error(`[Traccar Event] Falha ao buscar usuário ${userId} na API Traccar: ${response.status}`);
            return null;
        }
        const traccarUser = await response.json() as { id: number; email: string; [key: string]: any }; // Type assertion
        if (traccarUser && traccarUser.email) {
             console.log(`[Traccar Event - Placeholder] Email ${traccarUser.email} encontrado para Traccar User ID: ${userId}`);
            return traccarUser.email;
        } else {
             console.log(`[Traccar Event - Placeholder] Email não encontrado no retorno da API Traccar para User ID: ${userId}`);
        }
    } catch (error) {
        console.error(`[Traccar Event - Placeholder] Erro ao consultar API Traccar para User ID ${userId}:`, error);
        return null;
    }
    */

    // Exemplo 3: Mapeamento direto hardcoded (apenas para teste inicial)
    // const userMapping: { [key: string]: string } = {
    //     '1': 'user1@example.com',
    //     '123': 'outro@dominio.net',
    // };
    // return userMapping[String(userId)] || null;


    // Retorno padrão se nenhuma lógica encontrar o email
    console.warn(`[Traccar Event - Placeholder] Lógica real para buscar email do Traccar User ID ${userId} não implementada.`);
    return null;
}
// --------------- FIM DO PLACEHOLDER IMPORTANTE ---------------


export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }

    try {
        console.log("--- Evento Recebido do Traccar ---");
        // console.log("Body:", JSON.stringify(req.body, null, 2)); // Descomente para debug

        // Tipagem básica (ajuste conforme a estrutura real do seu payload Traccar)
        const event: { type?: string;[key: string]: any } | undefined = req.body.event;
        const device: { id?: number | string; name?: string; userId?: number | string;[key: string]: any } | undefined = req.body.device;

        if (!event || !device) {
            console.log("[Traccar Event] Evento ou dispositivo ausente no payload.");
            return res.status(200).send("Payload inválido, mas recebido."); // OK para Traccar
        }

        if (!device.userId) {
            console.log(`[Traccar Event] Evento ${event.type || 'desconhecido'} para device ${device.id || 'desconhecido'} sem userId.`);
            return res.status(200).send("Evento recebido, userId ausente.");
        }

        // 1. Identificar o Usuário (USANDO O PLACEHOLDER!)
        const userEmail = await getUserEmailByTraccarUserId(device.userId);
        if (!userEmail) {
            console.log(`[Traccar Event] Email não encontrado para Traccar UserID ${device.userId}. Impossível notificar.`);
            return res.status(200).send("Evento recebido, usuário não mapeado ou lookup falhou.");
        }
        console.log(`[Traccar Event] Evento para usuário ${userEmail} (Device ID: ${device.id}, Name: ${device.name || 'N/A'})`);

        // 2. Buscar Tokens do Usuário no Firestore
        const userDocRef = firestoreDb.collection('token-usuarios').doc(userEmail);
        const docSnap = await userDocRef.get();
        const userTokens: string[] = docSnap.exists ? (docSnap.data()?.fcmTokens || []) : [];

        if (userTokens.length === 0) {
            console.log(`[Traccar Event] Nenhum token FCM encontrado para ${userEmail} no Firestore.`);
            return res.status(200).send("Evento recebido, nenhum token FCM para o usuário.");
        }
        console.log(`[Traccar Event] ${userTokens.length} tokens encontrados para ${userEmail}.`);

        // 3. Montar a Notificação
        let notificationTitle = `Traccar: ${device.name || `ID ${device.id}`}`;
        let notificationBody = `Evento: ${event.type}`;
        switch (event.type) {
            case "deviceOnline": notificationBody = `${device.name || 'Dispositivo'} está online.`
                break
            case "deviceOffline": notificationBody = `${device.name || 'Dispositivo'} ficou offline.`
                break
            case "deviceUnknown": notificationBody = `${device.name || 'Dispositivo'} reportou status desconhecido.` // Exemplo
                break
            case "deviceMoving": notificationBody = `${device.name || 'Dispositivo'} começou a se mover.` // Exemplo
                break;
            case "deviceStopped": notificationBody = `${device.name || 'Dispositivo'} parou.` // Exemplo
                break;
            case "geofenceEnter": notificationBody = `${device.name || 'Dispositivo'} entrou na área ${req.body.geofence?.name || 'desconhecida'}.` // Exemplo
                break;
            case "geofenceExit": notificationBody = `${device.name || 'Dispositivo'} saiu da área ${req.body.geofence?.name || 'desconhecida'}.` // Exemplo
                break;
            // Adicione outros casos conforme necessário
            default: notificationBody = `Novo evento '${event.type || 'desconhecido'}' para ${device.name || 'dispositivo'}.`
        }

        // 4. Enviar Notificações (Multicast)
        const messagePayload: admin.messaging.MulticastMessage = {
            notification: { title: notificationTitle, body: notificationBody },
            tokens: userTokens,
            // Você pode adicionar 'data' para enviar dados extras para o app cliente
            // data: { eventType: event.type || '', deviceId: String(device.id || '') }
            // Pode configurar opções como prioridade, ttl etc no AndroidConfig/ApnsConfig se necessário
            // android: { notification: { sound: 'default' } },
            // apns: { payload: { aps: { sound: 'default' } } },
        };

        console.log(`[Traccar Event] Enviando ${messagePayload.notification?.title} / ${messagePayload.notification?.body} para ${userTokens.length} tokens de ${userEmail}...`);
        const response = await messaging.sendEachForMulticast(messagePayload);
        console.log(`[Traccar Event] Resultado: ${response.successCount} sucessos, ${response.failureCount} falhas.`);

        // 5. Limpeza de Tokens Inválidos (igual ao original, mas usando Firestore)
        if (response.failureCount > 0) {
            const tokensToDelete: string[] = [];
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    const failedToken = userTokens[idx];
                    // Log do erro vindo do FCM
                    const errorCode = resp.error?.code;
                    console.error(`[Traccar Event] Falha token ${failedToken.substring(0, 10)}... Código: ${errorCode} | Mensagem: ${resp.error?.message}`);
                    // Condições para remoção do token
                    if (errorCode === 'messaging/invalid-registration-token' ||
                        errorCode === 'messaging/registration-token-not-registered') {
                        tokensToDelete.push(failedToken);
                    }
                }
            });

            if (tokensToDelete.length > 0) {
                console.warn(`[Traccar Event] Removendo ${tokensToDelete.length} tokens inválidos/não registrados para ${userEmail}...`);
                // Usa arrayRemove para tirar os tokens inválidos do documento do usuário
                await userDocRef.update({
                    fcmTokens: admin.firestore.FieldValue.arrayRemove(...tokensToDelete)
                });
                console.log(`[Traccar Event] Tokens inválidos removidos do Firestore para ${userEmail}.`);
            }
        }

        // Responde sucesso para o Traccar mesmo com falhas parciais de envio
        res.status(200).send(`Evento processado. ${response.successCount} notificações enviadas com sucesso, ${response.failureCount} falharam.`);

    } catch (error) {
        console.error("[/api/traccar-event] Erro GERAL ao processar evento:", error);
        // OK para Traccar para evitar retentativas desnecessárias se for erro interno nosso
        res.status(200).send("Erro interno ao processar evento.");
    }
}