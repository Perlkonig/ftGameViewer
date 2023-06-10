import { writable } from "svelte/store";

export interface IPoint {
    x: number;
    y: number;
}

export interface ICircle {
    c: IPoint;
    r: number;
    startR?: number;
}

export interface IArc extends ICircle {
    left: number;
    right: number;
}

export interface ILine {
    p1: IPoint;
    p2: IPoint;
}

export interface IPoly {
    points: IPoint[];
}

export interface IAnnotation {
    type: "ARC"|"CIRCLE"|"LINE"|"POLY";
    note: ICircle|IArc|ILine|IPoly;
    id: string;
    color?: string;
    opacity?: number;
    strokeWidth?: number;
}

export const annotations = writable([] as IAnnotation[]);
// annotations.subscribe(val => {console.log(val)});
