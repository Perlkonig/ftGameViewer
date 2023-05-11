interface Star {
    x: number;
    y: number;
    r: number;
    colour: [number, number, number];
}

export class Starfield {
    public size: number = 1250;
    public padding: number = 10;
    public maxRadius: number = 8;
    public numStars: (size: number) => number = (size: number) => { return size; };
    public bgColour: string = "black";
    public starColour1: [number,number,number] = [255,255,255];
    public starColour2: [number,number,number] = [255,255,255];
    private stars: Star[] = [];

    constructor() {
        this.genStars();
    }

    private randomColour(): [number,number,number] {
        const u = Math.random();
        return this.starColour1.map((a, i) => Math.floor((1-u) * a + u * this.starColour2[i])) as [number,number,number];
    }

    private randomRadius(): number {
        const interval = this.stars.length / this.numStars(this.size);
        let min: number;
        let max: number;
        if (interval <= 0.5) {
            min = 1;
            max = this.maxRadius * 0.2;
        } else if (interval <= 0.8) {
            min = this.maxRadius * 0.2;
            max = this.maxRadius * 0.4;
        } else if (interval <= 0.95) {
            min = this.maxRadius * 0.4;
            max = this.maxRadius * 0.9;
        } else {
            min = this.maxRadius * 0.9;
            max = this.maxRadius * 1.2;
        }
        return (Math.random() * (max - min)) + min;
    }

    public genStars(): void {
        this.stars = [];
        const minCoord = this.padding;
        const maxCoord = this.size - this.padding;
        for (let i = 0; i < this.numStars(this.size); i++) {
            const x = Math.random() * (maxCoord - minCoord) + minCoord;
            const y = Math.random() * (maxCoord - minCoord) + minCoord;
            const r = this.randomRadius();
            const colour = this.randomColour();
            this.stars.push({x, y, r, colour});
        }
    }

    public genSvg(): string {
        let s = `<svg viewBox="-1 -1 ${this.size + 2} ${this.size + 2}">`;
        s += `<rect x="0" y="0" width="${this.size}" height="${this.size}" fill="${this.bgColour}"/>`;
        for (const star of this.stars) {
            s += `<circle cx="${star.x}" cy="${star.y}" r="${star.r}" fill="rgb(${star.colour.join(",")})" />`;
        }
        s += `</svg>`;
        return s;
    }
}