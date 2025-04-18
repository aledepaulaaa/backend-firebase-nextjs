// src/pages/api/traccar-event.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { firestoreDb, messaging } from '../../lib/firebaseAdmin'
import * as admin from 'firebase-admin'
import { runCorsMiddleware } from '@/lib/cors'

interface EventNotificationPayload {
    deviceId: string
    deviceName: string
    eventType: string
    eventTime: string
    attributes?: Record<string, any>
}

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    // Executar o middleware CORS
    await runCorsMiddleware(req, res)

    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST'])
        return res.status(405).end(`Method ${req.method} Not Allowed`)
    }

    const { email, event } = req.body as {
        email?: string
        event?: EventNotificationPayload
    }

    // Validar parâmetros
    if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: "Email inválido ou não fornecido." })
    }

    if (!event || typeof event !== 'object' || !event.deviceId || !event.eventType) {
        return res.status(400).json({ error: "Dados do evento inválidos ou incompletos." })
    }

    console.log(`[traccar-event] Processando evento ${event.eventType} para ${email}`)

    try {
        // Buscar tokens do usuário
        const userDocRef = firestoreDb.collection('token-usuarios').doc(email)
        const docSnap = await userDocRef.get()

        if (!docSnap.exists) {
            return res.status(404).json({ error: `Nenhum token encontrado para o email ${email}.` })
        }

        const userTokens = docSnap.data()?.fcmTokens || []

        if (userTokens.length === 0) {
            return res.status(404).json({ error: `Nenhum token encontrado para o email ${email}.` })
        }

        // Criar título e corpo da notificação com base no tipo de evento
        let title = 'Notificação'
        let body = ''

        const deviceName = event.deviceName || `Dispositivo ${event.deviceId}`

        switch (event.eventType) {
            case 'deviceOnline':
                title = 'Dispositivo Online'
                body = `${deviceName} está online`
                break
            case 'deviceOffline':
                title = 'Dispositivo Offline'
                body = `${deviceName} está offline`
                break
            case 'deviceMoving':
                title = 'Dispositivo Movendo'
                body = `${deviceName} está se movendo`
                break
            case 'deviceStopped':
                title = 'Dispositivo Parado'
                body = `${deviceName} está parado`
                break
            case 'ignitionOn':
                title = 'Ignição Ligada'
                body = `${deviceName}: Ignição ligada`
                break
            case 'ignitionOff':
                title = 'Ignição Desligada'
                body = `${deviceName}: Ignição desligada`
                break
            case 'geofenceEnter':
                title = 'Cerca Virtual'
                body = `${deviceName}: Entrou na cerca virtual ${event.attributes?.geofenceName || ''}`
                break
            case 'geofenceExit':
                title = 'Cerca Virtual'
                body = `${deviceName}: Saiu da cerca virtual ${event.attributes?.geofenceName || ''}`
                break
            case 'alarm':
                title = 'Alarme'
                body = `${deviceName}: ${event.attributes?.alarm || 'Alarme ativado'}`
                break
            default:
                body = `${deviceName}: ${event.eventType}`
        }

        // Criar payload para FCM
        const message: admin.messaging.MulticastMessage = {
            notification: {
                title: title,
                body: body
            },
            data: {
                deviceId: event.deviceId,
                eventType: event.eventType,
                eventTime: event.eventTime,
                url: `/device/${event.deviceId}`
            },
            tokens: userTokens,
            // Configurações para Android
            android: {
                priority: 'high',
                notification: {
                    clickAction: 'FLUTTER_NOTIFICATION_CLICK',
                    channelId: 'high_importance_channel',
                    priority: 'high',
                    defaultSound: true,
                    defaultVibrateTimings: true
                }
            },
            // Configurações para Apple
            apns: {
                payload: {
                    aps: {
                        sound: 'default',
                        badge: 1,
                        contentAvailable: true
                    }
                },
                headers: {
                    'apns-priority': '10'
                }
            },
            // Configurações para Web
            webpush: {
                notification: {
                    icon: '/icon-192x192.png',
                    badge: '/icon-64x64.png',
                    vibrate: [200, 100, 200],
                    actions: [
                        {
                            action: 'view',
                            title: 'Ver Detalhes'
                        }
                    ]
                },
                fcmOptions: {
                    link: `/device/${event.deviceId}`
                }
            }
        }

        // Enviar notificação
        console.log(`[traccar-event] Enviando para ${userTokens.length} tokens...`)
        const response = await messaging.sendEachForMulticast(message)

        // Verificar resultado
        if (response.successCount > 0) {
            console.log(`[traccar-event] Enviado com sucesso para ${response.successCount} de ${userTokens.length} tokens.`)

            // Limpar tokens inválidos
            const invalidTokens: string[] = []
            response.responses.forEach((resp, idx) => {
                if (!resp.success && (
                    resp.error?.code === 'messaging/invalid-registration-token' ||
                    resp.error?.code === 'messaging/registration-token-not-registered'
                )) {
                    invalidTokens.push(userTokens[idx])
                }
            })

            // Remover tokens inválidos do Firestore
            if (invalidTokens.length > 0) {
                console.log(`[traccar-event] Removendo ${invalidTokens.length} tokens inválidos...`)
                await userDocRef.update({
                    fcmTokens: admin.firestore.FieldValue.arrayRemove(...invalidTokens)
                })
            }

            return res.status(200).json({
                success: true,
                message: `Notificação enviada com sucesso para ${response.successCount} de ${userTokens.length} dispositivos.`,
                invalidTokensRemoved: invalidTokens.length
            })
        } else {
            console.error('[traccar-event] Falha ao enviar para todos os tokens.')
            return res.status(500).json({
                error: 'Falha ao enviar notificação para todos os tokens de destino.',
                details: response.responses.map(r => r.error?.message || 'Unknown error')
            })
        }
    } catch (error: any) {
        console.error('[traccar-event] Erro ao processar:', error)
        return res.status(500).json({
            error: 'Erro interno ao processar notificação de evento.',
            details: error.message
        })
    }
}

