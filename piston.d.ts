declare module "piston-client" {
    export interface ProgramLang { 
        language: string, 
        version: string, 
        aliases: string[]
    }
    
    export interface ExecuteResult { 
        language: string, 
        version: string, 
        run: {
            stdout: string,
            stderr: string,
            code: number,
            signal: number | null,
            output: string;
        }
    }
    
    export interface PistonClient {
        runtimes(): Promise<ProgramLang>;
        execute(lang: string, code: string): Promise<ExecuteResult>;
    }
    
    export default function piston({server}: {server: string}): PistonClient;
}

