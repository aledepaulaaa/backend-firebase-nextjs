import type { NextApiRequest, NextApiResponse } from 'next'
import { firestoreDb } from '@/lib/firebaseAdmin'
import admin from 'firebase-admin'
import { runCorsMiddleware } from '@/lib/cors'

// Interface para o payload do evento que o Traccar envia. Nenhuma alteração aqui.
interface EventNotificationPayload {
    id: number
    attributes?: Record<string, any>
    deviceId: number
    name: string // Este campo é populado pelo Traccar com o nome do dispositivo
    type: string
    eventTime: string
    positionId?: number
    geofenceId?: number
    maintenanceId?: number
}

// Interface para o corpo da requisição que o Traccar envia.
// Ele envia um objeto que contém a chave "event".
interface TraccarForwardRequest {
    event: EventNotificationPayload
    // O Traccar também pode enviar um objeto "position", mas não o usaremos aqui.
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    await runCorsMiddleware(req, res)

    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST'])
        return res.status(405).json({ error: `Método ${req.method} Não Permitido` })
    }

    // O corpo da requisição do Traccar é { "event": {...} }. Extraímos o objeto 'event'.
    const { event } = req.body as TraccarForwardRequest
    console.log("api/traccar-event - Corpo do request recebido:", req.body)

    // Validação para garantir que o objeto 'event' e seus campos essenciais existem.
    if (!event || !event.deviceId || !event.type) {
        return res.status(400).json({ error: 'Dados de evento inválidos ou malformados recebidos do Traccar.' })
    }

    try {
        const deviceId = event.deviceId
        console.log("ID DO DISPOSITIVO: ", deviceId)

        // --- NOVA LÓGICA INTELIGENTE ---
        // 1. Procurar na coleção 'token-usuarios' por um documento que contenha o deviceId do evento.
        const usersRef = firestoreDb.collection('token-usuarios')
        const snapshot = await usersRef.where('deviceIds', 'array-contains', deviceId).get()

        // 2. Se nenhum documento for encontrado, significa que nenhum usuário registrou este dispositivo.
        if (snapshot.empty) {
            console.log(`Nenhum usuário encontrado no Firestore para o deviceId: ${deviceId}`)
            return res.status(404).json({ error: `Nenhum usuário associado ao dispositivo ${deviceId}.` })
        }

        let totalSent = 0
        let totalFailed = 0
        let totalInvalidRemoved = 0

        // 3. Itera sobre cada usuário encontrado (geralmente será apenas um).
        for (const userDoc of snapshot.docs) {
            const userEmail = userDoc.id
            const fcmTokenData: any[] = userDoc.data()?.fcmTokens || []
            const tokens: string[] = fcmTokenData.map(t => t.fcmToken).filter(Boolean) // Garante que não há tokens nulos/undefined

            if (tokens.length === 0) {
                console.log(`Nenhum token FCM válido encontrado para o usuário ${userEmail}. Pulando.`)
                continue // Vai para o próximo usuário se houver mais algum
            }

            console.log(`Enviando notificação para ${userEmail} (${tokens.length} tokens) para o evento do deviceId ${deviceId}`)

            // 4. Cria o conteúdo da notificação (sua lógica original, sem alterações).
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

            // 5. Monta e envia a mensagem FCM (sua lógica original, sem alterações).
            const message: admin.messaging.MulticastMessage = {
                tokens,
                notification: makeNotification,
                data: {
                    name: String(event.name),
                    type: event.type,
                    eventTime: event.eventTime,
                    deviceId: String(event.deviceId) // Adicionado para referência no cliente
                },
                android: { priority: 'high', notification: { channelId: 'high_importance_channel', clickAction: 'FLUTTER_NOTIFICATION_CLICK' } },
                apns: { payload: { aps: { sound: 'default', badge: 1 } }, headers: { 'apns-priority': '10' } },
                webpush: { fcmOptions: { link: `/device/${event.deviceId}` }, notification: { icon: '/icon-192x192.png', badge: '/icon-64x64.png', vibrate: [200, 100, 200] } }
            }

            const response = await admin.messaging().sendEachForMulticast(message)
            totalSent += response.successCount
            totalFailed += response.failureCount

            // 6. Lógica de limpeza de tokens inválidos, agora adaptada para o loop.
            const invalidTokens: string[] = []
            response.responses.forEach((r, i) => {
                if (!r.success && ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(r.error?.code || '')) {
                    invalidTokens.push(tokens[i])
                }
            })

            if (invalidTokens.length > 0) {
                console.log(`Encontrados ${invalidTokens.length} tokens inválidos para ${userEmail}:`, invalidTokens)
                const validTokens = fcmTokenData.filter(t => !invalidTokens.includes(t.fcmToken))
                await userDoc.ref.update({ fcmTokens: validTokens })
                totalInvalidRemoved += invalidTokens.length
                console.log(`Tokens inválidos de ${userEmail} removidos do Firestore.`)
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Processamento de evento concluído.',
            sent: totalSent,
            failed: totalFailed,
            invalidRemoved: totalInvalidRemoved,
        })

    } catch (err: any) {
        console.error('[traccar-event] erro', err)
        return res.status(500).json({ error: 'Erro interno ao processar evento.' })
    }
}