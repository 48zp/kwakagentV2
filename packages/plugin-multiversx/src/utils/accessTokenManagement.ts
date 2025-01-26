import {type IAgentRuntime} from "@elizaos/core";

export function isUserAuthorized(
    userId: string,
    runtime: IAgentRuntime
): boolean {
    const authorizedUserId = runtime.getSetting("ACCESS_TOKEN_MANAGMENT_TO");
    console.log("UserID from message:", userId); // Log de l'ID de l'utilisateur
    console.log("Authorized UserID:", authorizedUserId); // Log de l'ID autorisé
    return userId === authorizedUserId; // Compare l'ID de l'utilisateur avec l'ID autorisé
}
