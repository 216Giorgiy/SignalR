// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the Apache License, Version 2.0. See License.txt in the project root for license information.

import { DataReceived, ConnectionClosed } from "./Common"
import { IConnection } from "./IConnection"
import { ITransport, TransferMode, TransportType, WebSocketTransport, ServerSentEventsTransport, LongPollingTransport } from "./Transports"
import { IHttpClient, HttpClient } from "./HttpClient"
import { IHttpConnectionOptions } from "./IHttpConnectionOptions"
import { ILogger, LogLevel } from "./ILogger"
import { LoggerFactory } from "./Loggers"

const enum ConnectionState {
    Initial,
    Connecting,
    Connected,
    Disconnected
}

interface INegotiateResponse {
    connectionId: string
    availableTransports: string[]
}

export class HttpConnection implements IConnection {
    private connectionState: ConnectionState;
    private url: string;
    private readonly httpClient: IHttpClient;
    private readonly logger: ILogger;
    private readonly options: IHttpConnectionOptions;
    private transport: ITransport;
    private connectionId: string;
    private startPromise: Promise<void>;

    readonly features: any = {};

    constructor(url: string, options: IHttpConnectionOptions = {}) {
        this.logger = LoggerFactory.createLogger(options.logging);
        this.url = this.resolveUrl(url);
        options = options || {};
        this.httpClient = options.httpClient || new HttpClient();
        this.connectionState = ConnectionState.Initial;
        this.options = options;
        if (!this.options.onunauthorized) {
            this.options.onunauthorized = function (location: string): void {
                if (typeof (window) !== "undefined") {
                    if (location || location !== "") {
                        window.location.replace(location);
                    }
                }
            };
        }
    }

    async start(): Promise<void> {
        if (this.connectionState != ConnectionState.Initial) {
            return Promise.reject(new Error("Cannot start a connection that is not in the 'Initial' state."));
        }

        this.connectionState = ConnectionState.Connecting;

        this.startPromise = this.startInternal();
        return this.startPromise;
    }

    private async startInternal(): Promise<void> {
        try {
            // let negotiatePayload: string;
            // try {
            // negotiatePayload = await this.httpClient.options(this.url);
            // } catch (e) {
            //     if (e.statusCode === 401) {
            //         if (this.options.onunauthorized) {
            //             this.options.onunauthorized(e.message);
            //             throw new Error("Unauthorized connection: redirect to " + e.message);
            //         }
            //     }
            //     throw e;
            // }
            // let negotiateResponse: INegotiateResponse = JSON.parse(negotiatePayload);
            // this.connectionId = negotiateResponse.connectionId;

            // // the user tries to stop the the connection when it is being started
            // if (this.connectionState == ConnectionState.Disconnected) {
            //     return;
            // }

            // this.url += (this.url.indexOf("?") == -1 ? "?" : "&") + `id=${this.connectionId}`;

            this.transport = this.createTransport(this.options.transport, [ "WebSockets" ]);//negotiateResponse.availableTransports);
            this.transport.onreceive = this.onreceive;
            this.transport.onclose = e => this.stopConnection(true, e);

            let requestedTransferMode =
                this.features.transferMode === TransferMode.Binary
                    ? TransferMode.Binary
                    : TransferMode.Text;

            this.features.transferMode = await this.transport.connect(this.url, requestedTransferMode);

            // only change the state if we were connecting to not overwrite
            // the state if the connection is already marked as Disconnected
            this.changeState(ConnectionState.Connecting, ConnectionState.Connected);
        }
        catch (e) {
            this.logger.log(LogLevel.Error, "Failed to start the connection. " + e);
            this.connectionState = ConnectionState.Disconnected;
            this.transport = null;
            throw e;
        };
    }

    private createTransport(transport: TransportType | ITransport, availableTransports: string[]): ITransport {
        if (!transport && availableTransports.length > 0) {
            transport = TransportType[availableTransports[0]];
        }
        if (transport === TransportType.WebSockets && availableTransports.indexOf(TransportType[transport]) >= 0) {
            return new WebSocketTransport(this.logger);
        }
        if (transport === TransportType.ServerSentEvents && availableTransports.indexOf(TransportType[transport]) >= 0) {
            return new ServerSentEventsTransport(this.httpClient, this.logger);
        }
        if (transport === TransportType.LongPolling && availableTransports.indexOf(TransportType[transport]) >= 0) {
            return new LongPollingTransport(this.httpClient, this.logger);
        }

        if (this.isITransport(transport)) {
            return transport;
        }

        throw new Error("No available transports found.");
    }

    private isITransport(transport: any): transport is ITransport {
        return typeof(transport) === "object" && "connect" in transport;
    }

    private changeState(from: ConnectionState, to: ConnectionState): Boolean {
        if (this.connectionState == from) {
            this.connectionState = to;
            return true;
        }
        return false;
    }

    send(data: any): Promise<void> {
        if (this.connectionState != ConnectionState.Connected) {
            throw new Error("Cannot send data if the connection is not in the 'Connected' State");
        }

        return this.transport.send(data);
    }

    async stop(): Promise<void> {
        let previousState = this.connectionState;
        this.connectionState = ConnectionState.Disconnected;

        try {
            await this.startPromise;
        }
        catch (e) {
            // this exception is returned to the user as a rejected Promise from the start method
        }
        this.stopConnection(/*raiseClosed*/ previousState == ConnectionState.Connected);
    }

    private stopConnection(raiseClosed: Boolean, error?: Error) {
        if (this.transport) {
            if (error) {
                this.logger.log(LogLevel.Error, "Transport closed with error: " + error);
            } else {
                this.logger.log(LogLevel.Information, "Transport closed.");
            }
            this.transport.stop();
            this.transport = null;

            if (error) {// && error.message.startsWith(authError)) {
                let authError: string = "Websocket closed with status code: 4401 (Unauthorized: redirect to ";
                let forbidError: string = "Websocket closed with status code: 4403 (Forbidden: redirect to ";
                let location: string;
                if (error.message.startsWith(authError)) {
                    location = error.message.substring(authError.length);
                } else if (error.message.startsWith(forbidError)) {
                    location = error.message.substring(forbidError.length);
                }
                if (location) {
                    location = location.substring(0, location.length - 1);
                    if (this.options.onunauthorized) {
                        this.options.onunauthorized(location);
                    }
                }
            }
        }

        this.connectionState = ConnectionState.Disconnected;

        if (raiseClosed && this.onclose) {
            this.onclose(error);
        }
    }

    private resolveUrl(url: string) : string {
        // startsWith is not supported in IE
        if (url.lastIndexOf("https://", 0) === 0 || url.lastIndexOf("http://", 0) === 0) {
            return url;
        }

        if (typeof window === 'undefined') {
            throw new Error(`Cannot resolve '${url}'.`);
        }

        let parser = window.document.createElement("a");
        parser.href = url;

        let baseUrl = (!parser.protocol || parser.protocol === ":")
            ? `${window.document.location.protocol}//${(parser.host || window.document.location.host)}`
            : `${parser.protocol}//${parser.host}`;

        if (!url || url[0] != '/') {
            url = '/' + url;
        }

        let normalizedUrl = baseUrl + url;
        this.logger.log(LogLevel.Information, `Normalizing '${url}' to '${normalizedUrl}'`);
        return normalizedUrl;
    }

    onreceive: DataReceived;
    onclose: ConnectionClosed;
}