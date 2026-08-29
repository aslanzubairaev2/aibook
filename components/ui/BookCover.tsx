"use client";

import { useState } from "react";

type Props = {
  /** Ссылка на обложку; её может не быть — тогда останется цветная подложка. */
  url: string | null | undefined;
  /** Заголовок — и подпись для скринридера, и то, из чего берётся цвет подложки. */
  title: string;
  /** Цветная подложка: показывается сразу и остаётся, если картинка не пришла. */
  fallbackColor: string;
  /** Короткая надпись поверх подложки, пока обложки нет («DE», «EN»). */
  label?: string;
  className?: string;
  /**
   * Обложки в первом экране грузятся сразу, остальные — по мере прокрутки.
   * Ставьте `true` только первым нескольким элементам списка.
   */
  eager?: boolean;
  /** Значки поверх обложки — например, наушники у аудиокниги. */
  children?: React.ReactNode;
};

/**
 * Обложка книги, которая не заставляет себя ждать.
 *
 * Раньше обложки были фоновой картинкой (`background-image`) — а фон нельзя
 * пометить `loading="lazy"`. Из-за этого открытие каталога запускало загрузку
 * всех обложек страницы разом, включая те, до которых прокрутка никогда не
 * дойдёт, и до их прихода на экране стояли пустые тёмные прямоугольники.
 *
 * Здесь наоборот: цветная подложка есть с первого кадра, а картинка — обычный
 * `<img>` с ленивой загрузкой, который проявляется поверх неё. Сеть тратится
 * только на то, что человек действительно видит, а «дырок» на экране нет
 * вообще — ни в начале, ни при неудачной загрузке.
 */
export function BookCover({ url, title, fallbackColor, label, className, eager, children }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(url) && !failed;

  return (
    <span className={`cover${className ? ` ${className}` : ""}`} style={{ background: fallbackColor }}>
      {/* Подпись видна, только пока сверху ничего не легло. */}
      {label && !loaded && <span className="cover-label">{label}</span>}
      {showImage && (
        /* Обычный <img>, а не next/image: обложки приходят с чужих хостов
           (gutenberg.org, archive.org), которых нет в `images.remotePatterns`,
           — next/image на них просто упадёт. Ленивую загрузку и асинхронное
           декодирование, ради которых всё и затевалось, даёт сам браузер. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url!}
          alt={title}
          className={`cover-img${loaded ? " is-loaded" : ""}`}
          loading={eager ? "eager" : "lazy"}
          // Декодирование уходит с главного потока: сотня обложек иначе
          // раскодируется в нём же и подвешивает прокрутку.
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
      {children}
    </span>
  );
}
