import type { NextApiRequest, NextApiResponse } from 'next'
import { firestoreDb } from '@/lib/firebaseAdmin'
import admin from 'firebase-admin'
import { runCorsMiddleware } from '@/lib/cors'

interface EventNotificationPayload {
    id: number
    attributes?: Record<string, any>
    deviceId: number
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
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` })
    }

    const { email, event } = req.body as TraccarEventRequest
    console.log({
        "Email: ": email,
        "Evento: ": event
    })

    function validarEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        return emailRegex.test(email)
    }

    // Validações básicas
    if (!email || !validarEmail(email)) {
        return res.status(400).json({ error: 'Email é obrigatório.' })
    }

    if (!event || !event.deviceId || !event.type) {
        return res.status(400).json({ error: 'Dados de evento inválidos.' })
    }

    try {
        // Obter tokens registrados
        const userDocRef = firestoreDb.collection('token-usuarios').doc(email)
        const userDoc = await userDocRef.get()

        if (!userDoc.exists) {
            return res.status(404).json({ error: `Nenhum registro de token para ${email}.` })
        }

        const tokens: string[] = userDoc.data()?.fcmTokens?.map((t: any) => t.fcmToken) || []
        if (tokens.length === 0) {
            return res.status(404).json({ error: 'Nenhum token disponível para envio.' })
        }

        // Helper para título e corpo
        const makeNotification = (() => {
            const base = event.id || `Dispositivo ${event.deviceId}`
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

        // Payload FCM
        const message: admin.messaging.MulticastMessage = {
            tokens,
            notification: makeNotification,
            data: {
                deviceId: event.deviceId as any,
                eventType: event.type,
                eventTime: event.eventTime,
                url: `/device/${event.deviceId}`
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

        // Envio e tratamento de respostas
        const batch = admin.messaging().sendEachForMulticast(message)
        const response = await batch

        // Filtrar tokens inválidos
        const invalid: string[] = []
        response.responses.forEach((r, i) => {
            if (!r.success && ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(r.error?.code || '')) {
                invalid.push(tokens[i])
            }
        })
        if (invalid.length) {
            await userDocRef.update({
                fcmTokens: admin.firestore.FieldValue.arrayRemove(...invalid.map(token => ({ fcmToken: token })))
            })
        }

        return res.status(200).json({
            success: true,
            sent: response.successCount,
            failed: response.failureCount,
            invalidRemoved: invalid.length
        })

    } catch (err: any) {
        console.error('[traccar-event] erro', err)
        return res.status(500).json({ error: 'Erro interno ao processar evento.' })
    }
}