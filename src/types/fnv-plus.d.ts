declare module "fnv-plus" {
    const fnv: {
        seed: (value: string) => void;
        hash: (value: string) => { hex: () => string };
    };
    export default fnv;
}
