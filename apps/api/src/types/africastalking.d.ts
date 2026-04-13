declare module 'africastalking' {
  interface SendOptions {
    to: string[]
    message: string
    from?: string
  }

  interface SMS {
    send(options: SendOptions): Promise<unknown>
  }

  interface AfricasTalkingInstance {
    SMS: SMS
  }

  function AfricasTalking(options: { apiKey: string; username: string }): AfricasTalkingInstance

  export = AfricasTalking
}
